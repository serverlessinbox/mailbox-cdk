package utils

import (
	"fmt"
	"strings"
)

// GetTokenFromCookies extracts a token value from cookie string
func GetTokenFromCookies(cookies, tokenName string) string {
	parts := strings.Split(cookies, ";")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(part, tokenName+"=") {
			return strings.TrimPrefix(part, tokenName+"=")
		}
	}
	return ""
}

// BuildRefreshTokenCookie creates a refresh token cookie header value
func BuildRefreshTokenCookie(token string) string {
	return fmt.Sprintf(
		"refresh_token=%s; Path=/auth; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000",
		token,
	)
}

// BuildCSRFTokenCookie creates a CSRF token cookie header value
func BuildCSRFTokenCookie(token string) string {
	return fmt.Sprintf(
		"csrf_token=%s; Path=/auth; Secure; SameSite=Strict; Max-Age=2592000",
		token,
	)
}

// BuildClearRefreshTokenCookie creates a cookie header to clear the refresh token
func BuildClearRefreshTokenCookie() string {
	return "refresh_token=; Path=/auth; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
}

// BuildClearCSRFTokenCookie creates a cookie header to clear the CSRF token
func BuildClearCSRFTokenCookie() string {
	return "csrf_token=; Path=/auth; Secure; SameSite=Strict; Max-Age=0"
}

// ExtractCSRFTokenFromRefreshToken generates a CSRF token from a refresh token
func ExtractCSRFTokenFromRefreshToken(refreshToken string) string {
	if len(refreshToken) < 20 {
		return refreshToken
	}
	return refreshToken[:20]
}

// BuildPKCEVerifierCookie creates a PKCE verifier cookie header value
// Stored temporarily during the authorization flow
func BuildPKCEVerifierCookie(verifier string) string {
	return fmt.Sprintf(
		"pkce_verifier=%s; Path=/auth; HttpOnly; Secure; SameSite=Strict; Max-Age=600",
		verifier,
	)
}

// BuildClearPKCEVerifierCookie creates a cookie header to clear the PKCE verifier
func BuildClearPKCEVerifierCookie() string {
	return "pkce_verifier=; Path=/auth; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
}
