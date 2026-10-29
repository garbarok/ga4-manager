package gsc

import (
	"encoding/json"
	"fmt"
	"os"
)

// writePermissionLevels are the GSC permission levels that allow write
// operations such as submitting or deleting sitemaps. siteRestrictedUser and
// below are read-only for these operations.
var writePermissionLevels = map[string]bool{
	"siteOwner":    true,
	"siteFullUser": true,
}

// SitePermission describes the authenticated principal's access to a property.
type SitePermission struct {
	SiteURL         string `json:"site_url"`
	PermissionLevel string `json:"permission_level"`
	CanWrite        bool   `json:"can_write"`
}

// CanWritePermission reports whether a GSC permission level allows write
// operations such as submitting or deleting sitemaps.
func CanWritePermission(level string) bool {
	return writePermissionLevels[level]
}

// GetSitePermission returns the authenticated principal's permission level for a
// single property via the Search Console sites.get endpoint.
func (c *Client) GetSitePermission(siteURL string) (*SitePermission, error) {
	if err := c.waitForRateLimit("GetSitePermission"); err != nil {
		return nil, err
	}
	site, err := c.service.Sites.Get(siteURL).Context(c.ctx).Do()
	if err != nil {
		return nil, fmt.Errorf("failed to get site permission for %s: %w", siteURL, err)
	}
	return &SitePermission{
		SiteURL:         site.SiteUrl,
		PermissionLevel: site.PermissionLevel,
		CanWrite:        CanWritePermission(site.PermissionLevel),
	}, nil
}

// ListSitePermissions returns every property the authenticated principal can
// access, with its permission level.
func (c *Client) ListSitePermissions() ([]SitePermission, error) {
	if err := c.waitForRateLimit("ListSitePermissions"); err != nil {
		return nil, err
	}
	resp, err := c.service.Sites.List().Context(c.ctx).Do()
	if err != nil {
		return nil, fmt.Errorf("failed to list sites: %w", err)
	}
	perms := make([]SitePermission, 0, len(resp.SiteEntry))
	for _, s := range resp.SiteEntry {
		perms = append(perms, SitePermission{
			SiteURL:         s.SiteUrl,
			PermissionLevel: s.PermissionLevel,
			CanWrite:        CanWritePermission(s.PermissionLevel),
		})
	}
	return perms, nil
}

// ServiceAccountIdentity is the principal behind GOOGLE_APPLICATION_CREDENTIALS.
type ServiceAccountIdentity struct {
	ClientEmail    string `json:"client_email"`
	ProjectID      string `json:"project_id"`
	CredentialPath string `json:"credential_path"`
}

// LoadServiceAccountIdentity reads the service-account email and project from
// the credentials file referenced by GOOGLE_APPLICATION_CREDENTIALS. It is
// best-effort: a missing file or a non-service-account credential yields empty
// fields rather than an error, so callers can still report what they know.
func LoadServiceAccountIdentity() ServiceAccountIdentity {
	id := ServiceAccountIdentity{CredentialPath: os.Getenv("GOOGLE_APPLICATION_CREDENTIALS")}
	if id.CredentialPath == "" {
		return id
	}
	data, err := os.ReadFile(id.CredentialPath)
	if err != nil {
		return id
	}
	var parsed struct {
		ClientEmail string `json:"client_email"`
		ProjectID   string `json:"project_id"`
	}
	if err := json.Unmarshal(data, &parsed); err == nil {
		id.ClientEmail = parsed.ClientEmail
		id.ProjectID = parsed.ProjectID
	}
	return id
}
