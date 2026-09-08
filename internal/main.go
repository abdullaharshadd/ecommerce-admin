package internal

import (
	"encoding/json"
	"net/http"
)

// Health answers the liveness probe.
func Health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy"})
}
