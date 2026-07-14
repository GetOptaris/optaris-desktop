package main

import (
	"os"
	"path/filepath"
	"testing"
)

// writeTempConfig writes raw JSON to a temp --config file and returns its path.
func writeTempConfig(t *testing.T, raw string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "optaris-config.json")
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatalf("write temp config: %v", err)
	}
	return path
}

// TestLoadConfigSynthesizesDefaultGroup verifies the built-in "all channels" group is
// injected into the engine config with every channel as a member, so a fresh install can
// route without the user creating a group first.
func TestLoadConfigSynthesizesDefaultGroup(t *testing.T) {
	path := writeTempConfig(t, `{
		"default_group_id": "",
		"channels": [
			{"id": "ch1", "models": ["m1"], "enabled": true},
			{"id": "ch2", "models": ["m2"], "enabled": false}
		],
		"groups": [],
		"settings": {}
	}`)

	cfg, meta, err := loadConfig(path)
	if err != nil {
		t.Fatalf("loadConfig: %v", err)
	}

	// The built-in group exists and contains every channel (enabled filtering happens later
	// in the router, not here).
	var found bool
	for _, g := range cfg.Groups {
		if g.ID == builtinDefaultGroupID {
			found = true
			if len(g.ChannelIDs) != 2 || g.ChannelIDs[0] != "ch1" || g.ChannelIDs[1] != "ch2" {
				t.Fatalf("built-in group members = %v, want [ch1 ch2]", g.ChannelIDs)
			}
		}
	}
	if !found {
		t.Fatalf("built-in group %q not synthesized; groups = %+v", builtinDefaultGroupID, cfg.Groups)
	}

	// Empty default_group_id resolves to the built-in group so requests route over all channels.
	if meta.defaultGroupID != builtinDefaultGroupID {
		t.Fatalf("defaultGroupID = %q, want %q (fallback)", meta.defaultGroupID, builtinDefaultGroupID)
	}
}

// TestLoadConfigExplicitDefaultGroupWins verifies an explicit default_group_id is honored
// over the built-in fallback.
func TestLoadConfigExplicitDefaultGroupWins(t *testing.T) {
	path := writeTempConfig(t, `{
		"default_group_id": "g_user",
		"channels": [{"id": "ch1", "models": ["m1"], "enabled": true}],
		"groups": [{"id": "g_user", "name": "mine", "channel_ids": ["ch1"]}],
		"settings": {}
	}`)

	_, meta, err := loadConfig(path)
	if err != nil {
		t.Fatalf("loadConfig: %v", err)
	}
	if meta.defaultGroupID != "g_user" {
		t.Fatalf("defaultGroupID = %q, want g_user", meta.defaultGroupID)
	}
}

// TestLoadConfigDeduplicatesBuiltinGroup verifies an on-disk group colliding with the
// built-in id (a legacy or hand-edited config) is dropped in favor of the synthesized one,
// so the snapshot never carries two groups with the same id.
func TestLoadConfigDeduplicatesBuiltinGroup(t *testing.T) {
	path := writeTempConfig(t, `{
		"default_group_id": "",
		"channels": [
			{"id": "ch1", "models": ["m1"], "enabled": true},
			{"id": "ch2", "models": ["m2"], "enabled": true}
		],
		"groups": [{"id": "grp_default", "name": "stale", "channel_ids": ["ch1"]}],
		"settings": {}
	}`)

	cfg, _, err := loadConfig(path)
	if err != nil {
		t.Fatalf("loadConfig: %v", err)
	}

	var count int
	for _, g := range cfg.Groups {
		if g.ID == builtinDefaultGroupID {
			count++
			// The synthesized group wins: all channels, not the stale single-channel list.
			if len(g.ChannelIDs) != 2 {
				t.Fatalf("built-in group members = %v, want both channels (synthesized, not stale)", g.ChannelIDs)
			}
		}
	}
	if count != 1 {
		t.Fatalf("found %d groups with id %q, want exactly 1", count, builtinDefaultGroupID)
	}
}
