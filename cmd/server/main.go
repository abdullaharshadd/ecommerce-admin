package main

import (
	"log"
	"net/http"

	"migrated-app/internal"
)

func main() {
	mux := internal.BuildRouter()
	log.Println("listening on :8080")
	if err := http.ListenAndServe(":8080", mux); err != nil {
		log.Fatal(err)
	}
}
