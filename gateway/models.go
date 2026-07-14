package main

import (
	"encoding/json"
	"net/http"

	optaris "github.com/getoptaris/optaris-core"
)

// modelsHandler serves GET /v1/models: the OpenAI "list models" shape, listing the models the
// active group can serve. The active group is the config-provided default (read live from the
// holder so hot-reload takes effect), and the model set comes from optaris-core's GroupModels
// (deduped, sorted, enabled-only). A missing/empty group yields an empty list rather than an
// error — friendlier for OpenAI-style clients that call this to populate a model picker.
//
// Auth is inherited from the mux-level withAuth wrapper, so this handler needs no key check.
func modelsHandler(eng *optaris.Engine, holder *configHolder) http.Handler {
	type modelObject struct {
		ID      string `json:"id"`
		Object  string `json:"object"`
		Created int64  `json:"created"`
		OwnedBy string `json:"owned_by"`
	}
	type modelList struct {
		Object string        `json:"object"`
		Data   []modelObject `json:"data"`
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ids := eng.GroupModels(holder.defaultGroupID())
		data := make([]modelObject, 0, len(ids))
		for _, id := range ids {
			data = append(data, modelObject{ID: id, Object: "model", Created: 0, OwnedBy: "optaris"})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(modelList{Object: "list", Data: data})
	})
}
