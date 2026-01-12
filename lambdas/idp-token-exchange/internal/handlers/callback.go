package handlers

import (
	"fmt"
	"net/http"

	"github.com/serverlessinbox/cognito-token-exchange/internal/utils"
)

// CallbackHandler exchanges the authorization code for tokens
func CallbackHandler(w http.ResponseWriter, r *http.Request) {
	config := utils.GetOAuthConfig()

	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, utils.BuildErrorResponse("Missing authorization code"), http.StatusBadRequest)
		return
	}

	host := r.Host
	if r.Header.Get("X-Forwarded-Host") != "" {
		host = r.Header.Get("X-Forwarded-Host")
	}

	callbackURL := fmt.Sprintf("https://%s/auth/callback", host)

	// Get PKCE verifier from cookie if PKCE is enabled
	var pkceVerifier string
	if config.UsePKCE {
		pkceVerifier = utils.GetTokenFromCookies(r.Header.Get("Cookie"), "pkce_verifier")
		if pkceVerifier == "" {
			http.Error(w, utils.BuildErrorResponse("Missing PKCE verifier"), http.StatusBadRequest)
			return
		}
	}

	tokenResp, err := utils.ExchangeCodeForTokens(config, code, callbackURL, pkceVerifier)
	if err != nil {
		http.Error(w, utils.BuildErrorResponse(err.Error()), http.StatusInternalServerError)
		return
	}

	// Validate group membership if required
	if config.RequiredGroup != "" {
		claims, err := utils.ParseIDTokenClaims(tokenResp.IDToken)
		if err != nil {
			http.Error(w, utils.BuildErrorResponse("Failed to parse token claims"), http.StatusInternalServerError)
			return
		}

		if !claims.HasGroup(config.RequiredGroup) {
			http.Error(w, utils.BuildErrorResponse(fmt.Sprintf("User not in required group: %s", config.RequiredGroup)), http.StatusForbidden)
			return
		}
	}

	// Build response body
	responseBody, err := utils.BuildTokenResponseBody(tokenResp.AccessToken, tokenResp.IDToken, tokenResp.ExpiresIn)
	if err != nil {
		http.Error(w, utils.BuildErrorResponse("Failed to build response"), http.StatusInternalServerError)
		return
	}

	// Set cookies
	refreshCookie := utils.BuildRefreshTokenCookie(tokenResp.RefreshToken)
	csrfToken := utils.ExtractCSRFTokenFromRefreshToken(tokenResp.RefreshToken)
	csrfCookie := utils.BuildCSRFTokenCookie(csrfToken)

	w.Header().Set("Content-Type", "application/json")
	w.Header().Add("Set-Cookie", refreshCookie)
	w.Header().Add("Set-Cookie", csrfCookie)

	// Clear PKCE verifier cookie if it was used
	if config.UsePKCE {
		w.Header().Add("Set-Cookie", utils.BuildClearPKCEVerifierCookie())
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(responseBody))
}
