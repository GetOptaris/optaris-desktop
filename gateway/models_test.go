package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	optaris "github.com/getoptaris/optaris-core"
	"github.com/getoptaris/optaris-core/model"
	"github.com/getoptaris/optaris-core/settings"
)

// TestModelsHandler checks the GET /v1/models envelope: the active group's models in
// OpenAI list shape, and an empty (but well-formed) list when the group has none.
func TestModelsHandler(t *testing.T) {
	eng := optaris.New(optaris.Config{
		Channels: []model.Channel{
			{ID: "ch1", Models: []string{"m2", "m1"}, Enabled: true},
			{ID: "ch2", Models: []string{"m3"}, Enabled: false}, // disabled → excluded
		},
		Groups: []model.Group{
			{ID: "g1", ChannelIDs: []string{"ch1", "ch2"}},
			{ID: "empty", ChannelIDs: []string{}},
		},
		Settings: settings.Default(),
	})

	type modelObject struct {
		ID      string `json:"id"`
		Object  string `json:"object"`
		OwnedBy string `json:"owned_by"`
	}
	type modelList struct {
		Object string        `json:"object"`
		Data   []modelObject `json:"data"`
	}

	decode := func(t *testing.T, groupID string) modelList {
		t.Helper()
		h := modelsHandler(eng, newConfigHolder(configMeta{defaultGroupID: groupID}))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/models", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
			t.Fatalf("Content-Type = %q, want application/json", ct)
		}
		var got modelList
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode body: %v (%s)", err, rec.Body.String())
		}
		return got
	}

	got := decode(t, "g1")
	if got.Object != "list" {
		t.Fatalf("object = %q, want list", got.Object)
	}
	want := []string{"m1", "m2"} // deduped+sorted from ch1; disabled ch2 excluded
	if len(got.Data) != len(want) {
		t.Fatalf("data = %+v, want ids %v", got.Data, want)
	}
	for i, m := range got.Data {
		if m.ID != want[i] || m.Object != "model" || m.OwnedBy != "optaris" {
			t.Fatalf("data[%d] = %+v, want id=%q object=model owned_by=optaris", i, m, want[i])
		}
	}

	// Empty group → well-formed empty list (never null), so OpenAI clients don't choke.
	empty := decode(t, "empty")
	if empty.Object != "list" || empty.Data == nil || len(empty.Data) != 0 {
		t.Fatalf("empty group = %+v, want {object:list, data:[]}", empty)
	}
}
