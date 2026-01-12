package main

import (
	"net/http"

	"github.com/akrylysov/algnhsa"

	"github.com/serverlessinbox/cognito-token-exchange/internal/handlers"
)

func main() {
	mux := http.NewServeMux()

	// OAuth routes
	mux.HandleFunc("/auth/authorize", handlers.AuthorizeHandler)
	mux.HandleFunc("/auth/callback", handlers.CallbackHandler)
	mux.HandleFunc("/auth/token", handlers.TokenHandler)
	mux.HandleFunc("/auth/logout", handlers.LogoutHandler)

	algnhsa.ListenAndServe(mux, nil)
}
