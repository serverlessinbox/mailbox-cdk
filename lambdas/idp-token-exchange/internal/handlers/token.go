package handlers

import (
	"net/http"

	"github.com/serverlessinbox/cognito-token-exchange/internal/utils"
)

// TokenHandler refreshes the access token using refresh token
func TokenHandler(w http.ResponseWriter, r *http.Request) {
	refreshToken := utils.GetTokenFromCookies(r.Header.Get("Cookie"), "refresh_token")
	if refreshToken == "" {
		http.Error(w, utils.BuildErrorResponse("No refresh token found"), http.StatusUnauthorized)
		return
	}

	// Verify CSRF token
	csrfToken := utils.GetTokenFromCookies(r.Header.Get("Cookie"), "csrf_token")
	expectedCSRFToken := utils.ExtractCSRFTokenFromRefreshToken(refreshToken)
	if csrfToken == "" || csrfToken != expectedCSRFToken {
		http.Error(w, utils.BuildErrorResponse("Invalid CSRF token"), http.StatusForbidden)
		return
	}

	config := utils.GetOAuthConfig()
	tokenResp, err := utils.RefreshAccessToken(config, refreshToken)
	if err != nil {
		http.Error(w, utils.BuildErrorResponse(err.Error()), http.StatusInternalServerError)
		return
	}

	// Build response body
	responseBody, err := utils.BuildTokenResponseBody(tokenResp.AccessToken, tokenResp.IDToken, tokenResp.ExpiresIn)
	if err != nil {
		http.Error(w, utils.BuildErrorResponse("Failed to build response"), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	// Update refresh token cookie if a new one was issued
	if tokenResp.RefreshToken != "" && tokenResp.RefreshToken != refreshToken {
		refreshCookie := utils.BuildRefreshTokenCookie(tokenResp.RefreshToken)
		csrfToken := utils.ExtractCSRFTokenFromRefreshToken(tokenResp.RefreshToken)
		csrfCookie := utils.BuildCSRFTokenCookie(csrfToken)
		w.Header().Add("Set-Cookie", refreshCookie)
		w.Header().Add("Set-Cookie", csrfCookie)
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(responseBody))
}
