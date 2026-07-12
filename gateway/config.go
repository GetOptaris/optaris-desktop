package main

// Config delivery: the Electron main process owns the config store. It writes a
// single JSON file (channels / groups / settings, including the plaintext upstream
// APIKeys) and passes its path via --config. The gateway loads it at startup to
// build the engine Config, and hot-reloads it via eng.LoadConfig when the file
// changes on disk (detected by mtime polling — cross-platform, zero extra deps).
//
// The wire shape below is the contract between the (TypeScript) main process and
// this binary; its json tags are snake_case to match settings.Settings.

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sync/atomic"
	"time"

	optaris "github.com/getoptaris/optaris-core"
	"github.com/getoptaris/optaris-core/model"
	"github.com/getoptaris/optaris-core/settings"
)

// configPollInterval is how often the gateway re-stats --config to pick up edits
// written by the parent. A couple of seconds is plenty for a desktop control plane.
const configPollInterval = 2 * time.Second

// wireChannel is the on-disk JSON shape of one upstream channel. It mirrors
// model.Channel (which has no json tags of its own) with an explicit snake_case
// contract. APIKey is the plaintext upstream credential.
type wireChannel struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	BaseURL     string    `json:"base_url"`
	APIKey      string    `json:"api_key"`
	Models      []string  `json:"models"`
	PriceWeight float64   `json:"price_weight"`
	Enabled     bool      `json:"enabled"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// wireGroup is the on-disk JSON shape of one routing group.
type wireGroup struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	ChannelIDs []string  `json:"channel_ids"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// gatewayConfig is the full config document the parent writes to --config.
//
// Settings is kept as raw JSON so we can overlay only the provided fields onto
// settings.Default(): a partial settings object in the file keeps sensible
// defaults for everything it omits (json.Unmarshal leaves absent fields alone).
type gatewayConfig struct {
	// DefaultGroupID is the group every request routes to until per-request auth /
	// tenancy resolution lands (phase 3). Empty → fall back to the first group.
	DefaultGroupID string          `json:"default_group_id"`
	Channels       []wireChannel   `json:"channels"`
	Groups         []wireGroup     `json:"groups"`
	Settings       json.RawMessage `json:"settings"`
}

// configMeta holds the derived, request-time-relevant bits of a loaded config that
// live outside the engine: the resolved default group id (read by the routing
// middleware) and the set of plaintext APIKeys (read by the persistence layer as a
// belt-and-suspenders redaction list). Held atomically so hot-reload is lock-free.
type configMeta struct {
	defaultGroupID string
	secrets        []string
}

// loadConfig reads and parses the config file into an engine Config plus the
// derived configMeta. Missing fields in the settings object fall back to defaults.
func loadConfig(path string) (optaris.Config, configMeta, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return optaris.Config{}, configMeta{}, err
	}

	var gc gatewayConfig
	if err := json.Unmarshal(raw, &gc); err != nil {
		return optaris.Config{}, configMeta{}, fmt.Errorf("parse config: %w", err)
	}

	// Start from built-in defaults, overlay whatever the file specifies.
	s := settings.Default()
	if len(gc.Settings) > 0 {
		if err := json.Unmarshal(gc.Settings, &s); err != nil {
			return optaris.Config{}, configMeta{}, fmt.Errorf("parse settings: %w", err)
		}
	}

	channels := make([]model.Channel, 0, len(gc.Channels))
	secrets := make([]string, 0, len(gc.Channels))
	for _, c := range gc.Channels {
		channels = append(channels, model.Channel{
			ID:          c.ID,
			Name:        c.Name,
			BaseURL:     c.BaseURL,
			APIKey:      c.APIKey,
			Models:      c.Models,
			PriceWeight: c.PriceWeight,
			Enabled:     c.Enabled,
			CreatedAt:   c.CreatedAt,
			UpdatedAt:   c.UpdatedAt,
		})
		if c.APIKey != "" {
			secrets = append(secrets, c.APIKey)
		}
	}

	groups := make([]model.Group, 0, len(gc.Groups))
	for _, g := range gc.Groups {
		groups = append(groups, model.Group{
			ID:         g.ID,
			Name:       g.Name,
			ChannelIDs: g.ChannelIDs,
			CreatedAt:  g.CreatedAt,
			UpdatedAt:  g.UpdatedAt,
		})
	}

	cfg := optaris.Config{Groups: groups, Channels: channels, Settings: s}
	meta := configMeta{
		defaultGroupID: resolveDefaultGroup(gc.DefaultGroupID, groups),
		secrets:        secrets,
	}
	return cfg, meta, nil
}

// resolveDefaultGroup picks the group every request routes to: the explicit
// default_group_id when set, otherwise the first group, otherwise empty (which the
// engine treats as "no route" and rejects — fail-loud, as intended).
func resolveDefaultGroup(explicit string, groups []model.Group) string {
	if explicit != "" {
		return explicit
	}
	if len(groups) > 0 {
		return groups[0].ID
	}
	return ""
}

// configHolder holds the current configMeta behind an atomic pointer so the
// request path (routing middleware) and the persistence layer can read it without
// locking while hot-reload swaps it wholesale.
type configHolder struct {
	p atomic.Pointer[configMeta]
}

func newConfigHolder(m configMeta) *configHolder {
	h := &configHolder{}
	h.p.Store(&m)
	return h
}

func (h *configHolder) set(m configMeta) { h.p.Store(&m) }

// defaultGroupID returns the group id the routing middleware injects per request.
func (h *configHolder) defaultGroupID() string { return h.p.Load().defaultGroupID }

// secrets returns the current set of plaintext upstream APIKeys, used only to
// double-check they never leak into on-disk capture.
func (h *configHolder) secrets() []string { return h.p.Load().secrets }

// watch polls the config file's mtime and hot-reloads on change. It seeds its
// baseline with initialMod (the mtime observed at startup load) so it does not
// redundantly reload the config already applied. A parse error keeps the previous
// config in place (fail-safe) rather than dropping to an empty one.
func (h *configHolder) watch(ctx context.Context, path string, eng *optaris.Engine, initialMod time.Time) {
	ticker := time.NewTicker(configPollInterval)
	defer ticker.Stop()

	lastMod := initialMod
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			fi, err := os.Stat(path)
			if err != nil {
				// File may be mid-rewrite (or briefly absent during an atomic
				// rename); just retry on the next tick.
				continue
			}
			mod := fi.ModTime()
			if !mod.After(lastMod) {
				continue
			}
			cfg, meta, err := loadConfig(path)
			if err != nil {
				// Keep the previous config; advance lastMod so we don't retry the
				// same broken file every tick.
				log.Printf("config reload failed, keeping previous config: %v", err)
				lastMod = mod
				continue
			}
			lastMod = mod
			h.set(meta)
			eng.LoadConfig(cfg)
			log.Printf("config reloaded: channels=%d groups=%d default_group=%q",
				len(cfg.Channels), len(cfg.Groups), meta.defaultGroupID)
		}
	}
}

// fileModTime returns the file's mtime, or the zero time if it cannot be stat'd.
// Used to seed the watcher's baseline in the safe direction: on any uncertainty we
// seed "older", so at worst we reload once redundantly, never miss a change.
func fileModTime(path string) time.Time {
	fi, err := os.Stat(path)
	if err != nil {
		return time.Time{}
	}
	return fi.ModTime()
}
