package handlers

import (
	"net/http"

	"github.com/serverlessinbox/cognito-token-exchange/internal/utils"
)

// LogoutHandler clears the refresh token cookie
func LogoutHandler(w http.ResponseWriter, r *http.Request) {
	clearRefreshCookie := utils.BuildClearRefreshTokenCookie()
	clearCSRFCookie := utils.BuildClearCSRFTokenCookie()

	w.Header().Set("Content-Type", "application/json")
	w.Header().Add("Set-Cookie", clearRefreshCookie)
	w.Header().Add("Set-Cookie", clearCSRFCookie)
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"message":"Logged out successfully"}`))
}
