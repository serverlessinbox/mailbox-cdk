package utils

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
)

// IDTokenClaims represents the claims in an ID token with support for multiple group claim formats
type IDTokenClaims struct {
	// AWS Cognito uses cognito:groups
	CognitoGroups []string `json:"cognito:groups"`
	// Azure AD uses roles
	Roles []string `json:"roles"`
	// Microsoft/Azure sometimes uses groups
	Groups []string `json:"groups"`
	// Some providers use resource_access.roles (Keycloak pattern)
	ResourceAccess map[string]interface{} `json:"resource_access"`
	// Google Workspace Directory uses roles claim
	// GitHub uses org_role claim for organization role
	OrgRole string `json:"org_role"`
	// Generic roles claim used by some providers
	RealmRoles []string `json:"realm_roles"`
}

// ParseIDTokenClaims extracts claims from a JWT token (without verification)
// Used for group checking - verification happens via the OAuth provider
func ParseIDTokenClaims(idToken string) (*IDTokenClaims, error) {
	// JWT format: header.payload.signature
	parts := strings.Split(idToken, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid token format")
	}

	// Decode payload (base64 URL encoded)
	payload := parts[1]
	// Add padding if needed
	switch len(payload) % 4 {
	case 2:
		payload += "=="
	case 3:
		payload += "="
	}

	payloadBytes, err := base64.URLEncoding.DecodeString(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to decode token payload: %w", err)
	}

	var claims IDTokenClaims
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return nil, fmt.Errorf("failed to parse token claims: %w", err)
	}

	return &claims, nil
}

// GetAllGroups extracts groups/roles from any supported claim format
// Returns a flat list of all group/role names across all supported claims
func (c *IDTokenClaims) GetAllGroups() []string {
	var allGroups []string

	// Add Cognito groups (AWS Cognito)
	allGroups = append(allGroups, c.CognitoGroups...)

	// Add roles (Azure AD, generic roles)
	allGroups = append(allGroups, c.Roles...)

	// Add groups (some providers use this)
	allGroups = append(allGroups, c.Groups...)

	// Add realm roles (Keycloak)
	allGroups = append(allGroups, c.RealmRoles...)

	// Add org_role if present (GitHub)
	if c.OrgRole != "" {
		allGroups = append(allGroups, c.OrgRole)
	}

	// Extract roles from resource_access (Keycloak pattern: resource_access.{client_id}.roles)
	if c.ResourceAccess != nil {
		for _, resource := range c.ResourceAccess {
			if resourceMap, ok := resource.(map[string]interface{}); ok {
				if roles, ok := resourceMap["roles"].([]interface{}); ok {
					for _, role := range roles {
						if roleStr, ok := role.(string); ok {
							allGroups = append(allGroups, roleStr)
						}
					}
				}
			}
		}
	}

	return allGroups
}

// HasGroup checks if the claims contain the required group/role
// Checks all supported group/role claim formats
func (c *IDTokenClaims) HasGroup(requiredGroup string) bool {
	if requiredGroup == "" {
		return true // No group requirement
	}

	allGroups := c.GetAllGroups()
	for _, group := range allGroups {
		if group == requiredGroup {
			return true
		}
	}
	return false
}
