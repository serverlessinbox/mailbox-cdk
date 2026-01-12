package utils

import (
	"encoding/json"
)

// BuildTokenResponseBody creates a JSON response body with token information
func BuildTokenResponseBody(accessToken, idToken string, expiresIn int) (string, error) {
	responseBody := map[string]interface{}{
		"access_token": accessToken,
		"id_token":     idToken,
		"expires_in":   expiresIn,
	}
	bodyJSON, err := json.Marshal(responseBody)
	if err != nil {
		return "", err
	}
	return string(bodyJSON), nil
}

// BuildErrorResponse creates a JSON error response body
func BuildErrorResponse(message string) string {
	return `{"error":"` + message + `"}`
}
