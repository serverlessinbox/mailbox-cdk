package handlers

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/serverlessinbox/cognito-token-exchange/internal/utils"
)

// AuthorizeHandler redirects to the OAuth authorization endpoint
func AuthorizeHandler(w http.ResponseWriter, r *http.Request) {
	config := utils.GetOAuthConfig()

	host := r.Host
	if r.Header.Get("X-Forwarded-Host") != "" {
		host = r.Header.Get("X-Forwarded-Host")
	}

	callbackURL := fmt.Sprintf("https://%s/auth/callback", host)

	// Build scope string from configured scopes
	scopeString := strings.Join(config.Scopes, " ")

	authURLParams := url.Values{
		"client_id":     []string{config.ClientID},
		"response_type": []string{"code"},
		"redirect_uri":  []string{callbackURL},
		"scope":         []string{scopeString},
	}

	// Add PKCE parameters if enabled
	var pkceVerifier string
	if config.UsePKCE {
		pkce, err := utils.GeneratePKCE()
		if err != nil {
			http.Error(w, utils.BuildErrorResponse("Failed to generate PKCE"), http.StatusInternalServerError)
			return
		}
		pkceVerifier = pkce.Verifier
		authURLParams.Set("code_challenge", pkce.Challenge)
		authURLParams.Set("code_challenge_method", "S256")
	}

	authURL := config.AuthorizationEndpoint + "?" + authURLParams.Encode()

	// Set PKCE verifier cookie if generated
	if pkceVerifier != "" {
		w.Header().Add("Set-Cookie", utils.BuildPKCEVerifierCookie(pkceVerifier))
	}

	http.Redirect(w, r, authURL, http.StatusFound)
}
