package utils

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	IDToken      string `json:"id_token,omitempty"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	TokenType    string `json:"token_type"`
}

// ExchangeCodeForTokens exchanges an authorization code for tokens
// Uses Authorization Code Grant with client authentication
// Supports both form-encoded and HTTP Basic Auth for client credentials
// Optionally includes PKCE verifier if provided
func ExchangeCodeForTokens(config OAuthConfig, code, callbackURL, pkceVerifier string) (*TokenResponse, error) {
	tokenReq := url.Values{
		"grant_type":   []string{"authorization_code"},
		"code":         []string{code},
		"redirect_uri": []string{callbackURL},
	}

	// Only include client_id in body if using form authentication
	if config.AuthMethod != "header" {
		tokenReq.Set("client_id", config.ClientID)
		if config.ClientSecret != "" {
			tokenReq.Set("client_secret", config.ClientSecret)
		}
	}

	// Add PKCE verifier if provided
	if pkceVerifier != "" {
		tokenReq.Set("code_verifier", pkceVerifier)
	}

	req, err := http.NewRequest("POST", config.TokenEndpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	// Use HTTP Basic Auth if configured
	if config.AuthMethod == "header" {
		basicAuth := base64.StdEncoding.EncodeToString(
			[]byte(config.ClientID + ":" + config.ClientSecret),
		)
		req.Header.Set("Authorization", "Basic "+basicAuth)
	}

	req.Body = io.NopCloser(bytes.NewBufferString(url.Values(tokenReq).Encode()))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token exchange failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token endpoint returned %d: %s", resp.StatusCode, string(body))
	}

	var tokenResp TokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, fmt.Errorf("failed to parse token response: %w", err)
	}

	return &tokenResp, nil
}

// RefreshAccessToken refreshes an access token using a refresh token
// Uses client credentials for authentication (form or HTTP Basic Auth)
func RefreshAccessToken(config OAuthConfig, refreshToken string) (*TokenResponse, error) {
	tokenReq := url.Values{
		"grant_type":    []string{"refresh_token"},
		"refresh_token": []string{refreshToken},
	}

	// Only include client_id in body if using form authentication
	if config.AuthMethod != "header" {
		tokenReq.Set("client_id", config.ClientID)
		if config.ClientSecret != "" {
			tokenReq.Set("client_secret", config.ClientSecret)
		}
	}

	req, err := http.NewRequest("POST", config.TokenEndpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	// Use HTTP Basic Auth if configured
	if config.AuthMethod == "header" {
		basicAuth := base64.StdEncoding.EncodeToString(
			[]byte(config.ClientID + ":" + config.ClientSecret),
		)
		req.Header.Set("Authorization", "Basic "+basicAuth)
	}

	req.Body = io.NopCloser(bytes.NewBufferString(url.Values(tokenReq).Encode()))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token refresh failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token endpoint returned %d", resp.StatusCode)
	}

	var tokenResp TokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, fmt.Errorf("failed to parse token response: %w", err)
	}

	return &tokenResp, nil
}
