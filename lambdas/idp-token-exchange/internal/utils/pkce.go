package utils

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
)

// PKCEPair represents a PKCE code verifier and challenge
type PKCEPair struct {
	Verifier  string
	Challenge string
}

// GeneratePKCE generates a PKCE code verifier and challenge
// Uses S256 method (SHA256) which is the recommended approach
func GeneratePKCE() (*PKCEPair, error) {
	// Generate a 32-byte random string for the verifier
	verifierBytes := make([]byte, 32)
	if _, err := rand.Read(verifierBytes); err != nil {
		return nil, fmt.Errorf("failed to generate random bytes: %w", err)
	}

	// Base64 URL encode the verifier (without padding)
	verifier := base64.RawURLEncoding.EncodeToString(verifierBytes)

	// Create the challenge by hashing the verifier
	hash := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(hash[:])

	return &PKCEPair{
		Verifier:  verifier,
		Challenge: challenge,
	}, nil
}
