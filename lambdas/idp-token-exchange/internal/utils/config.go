package utils

import (
	"fmt"
	"strings"

	"shared/env"
)

type OAuthConfig struct {
	Issuer                string
	TokenEndpoint         string
	AuthorizationEndpoint string
	ClientID              string
	ClientSecret          string
	Scopes                []string
	// AuthMethod is "form" or "header" for client credential authentication
	AuthMethod string
	// UsePKCE enables PKCE (Proof Key for Code Exchange)
	UsePKCE bool
	// RequiredGroup optionally restricts access to users in a specific group
	// If empty, no group check is performed
	RequiredGroup string
}

// GetOAuthConfig returns the OAuth configuration from environment variables
// All configuration must be explicitly provided - no defaults
func GetOAuthConfig() OAuthConfig {
	authMethod := env.MustGet("OAUTH_AUTH_METHOD")
	if authMethod != "form" && authMethod != "header" {
		panic(fmt.Sprintf("OAUTH_AUTH_METHOD must be 'form' or 'header', got: %s", authMethod))
	}

	usePKCE := env.MustGet("OAUTH_USE_PKCE")
	if usePKCE != "true" && usePKCE != "false" {
		panic(fmt.Sprintf("OAUTH_USE_PKCE must be 'true' or 'false', got: %s", usePKCE))
	}

	// RequiredGroup is optional - empty string means no group restriction
	requiredGroup := env.Get("OAUTH_REQUIRED_GROUP", "")

	// ClientSecret is optional to support public clients (e.g. Cognito + PKCE).
	// If empty, we must not attempt HTTP Basic auth.
	clientSecret := env.Get("OAUTH_CLIENT_SECRET", "")
	if authMethod == "header" && clientSecret == "" {
		panic("OAUTH_AUTH_METHOD cannot be 'header' when OAUTH_CLIENT_SECRET is empty")
	}

	return OAuthConfig{
		Issuer:                env.MustGet("OAUTH_ISSUER"),
		TokenEndpoint:         env.MustGet("OAUTH_TOKEN_ENDPOINT"),
		AuthorizationEndpoint: env.MustGet("OAUTH_AUTHORIZATION_ENDPOINT"),
		ClientID:              env.MustGet("OAUTH_CLIENT_ID"),
		ClientSecret:          clientSecret,
		Scopes:                strings.Split(env.MustGet("OAUTH_SCOPES"), ","),
		AuthMethod:            authMethod,
		UsePKCE:               usePKCE == "true",
		RequiredGroup:         requiredGroup,
	}
}
