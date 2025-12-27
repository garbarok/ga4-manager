package gsc

import (
	"fmt"
	"net/url"
	"strings"
)

// SitemapInfo contains information about a sitemap
type SitemapInfo struct {
	Path            string
	LastSubmitted   string
	LastDownloaded  string
	IsPending       bool
	IsSitemapsIndex bool
	Errors          int64
	Warnings        int64
	ContentsCount   int64 // URLs in sitemap
	Contents        []SitemapContentInfo
}

// SitemapContentInfo contains information about sitemap contents
type SitemapContentInfo struct {
	Type      string
	Submitted int64
	Indexed   int64
}

// ListSitemaps retrieves all sitemaps for a site
// siteURL must be a verified property in Search Console (e.g., "https://example.com/")
func (c *Client) ListSitemaps(siteURL string) ([]SitemapInfo, error) {
	if err := validateSiteURL(siteURL); err != nil {
		return nil, err
	}

	if err := c.waitForRateLimit("ListSitemaps"); err != nil {
		return nil, err
	}

	c.logger.Info("listing sitemaps", "site_url", siteURL)

	sitemapsListResponse, err := c.service.Sitemaps.List(siteURL).Do()
	if err != nil {
		c.logger.Error("failed to list sitemaps",
			"site_url", siteURL,
			"error", err)
		return nil, fmt.Errorf("failed to list sitemaps for %s: %w", siteURL, err)
	}

	sitemaps := make([]SitemapInfo, 0, len(sitemapsListResponse.Sitemap))
	for _, sm := range sitemapsListResponse.Sitemap {
		info := SitemapInfo{
			Path:            sm.Path,
			LastSubmitted:   sm.LastSubmitted,
			LastDownloaded:  sm.LastDownloaded,
			IsPending:       sm.IsPending,
			IsSitemapsIndex: sm.IsSitemapsIndex,
			Errors:          sm.Errors,
			Warnings:        sm.Warnings,
		}

		// Extract content information
		if sm.Contents != nil {
			info.Contents = make([]SitemapContentInfo, 0, len(sm.Contents))
			for _, content := range sm.Contents {
				info.Contents = append(info.Contents, SitemapContentInfo{
					Type:      content.Type,
					Submitted: content.Submitted,
					Indexed:   content.Indexed,
				})
				info.ContentsCount += content.Submitted
			}
		}

		sitemaps = append(sitemaps, info)
	}

	c.logger.Info("sitemaps retrieved successfully",
		"site_url", siteURL,
		"count", len(sitemaps))

	return sitemaps, nil
}

// GetSitemap retrieves information about a specific sitemap
func (c *Client) GetSitemap(siteURL, sitemapURL string) (*SitemapInfo, error) {
	if err := validateSiteURL(siteURL); err != nil {
		return nil, err
	}

	if err := validateSitemapURL(sitemapURL); err != nil {
		return nil, err
	}

	if err := c.waitForRateLimit("GetSitemap"); err != nil {
		return nil, err
	}

	c.logger.Info("getting sitemap", "site_url", siteURL, "sitemap_url", sitemapURL)

	sm, err := c.service.Sitemaps.Get(siteURL, sitemapURL).Do()
	if err != nil {
		c.logger.Error("failed to get sitemap",
			"site_url", siteURL,
			"sitemap_url", sitemapURL,
			"error", err)
		return nil, fmt.Errorf("failed to get sitemap %s: %w", sitemapURL, err)
	}

	info := &SitemapInfo{
		Path:            sm.Path,
		LastSubmitted:   sm.LastSubmitted,
		LastDownloaded:  sm.LastDownloaded,
		IsPending:       sm.IsPending,
		IsSitemapsIndex: sm.IsSitemapsIndex,
		Errors:          sm.Errors,
		Warnings:        sm.Warnings,
	}

	if sm.Contents != nil {
		info.Contents = make([]SitemapContentInfo, 0, len(sm.Contents))
		for _, content := range sm.Contents {
			info.Contents = append(info.Contents, SitemapContentInfo{
				Type:      content.Type,
				Submitted: content.Submitted,
				Indexed:   content.Indexed,
			})
			info.ContentsCount += content.Submitted
		}
	}

	c.logger.Info("sitemap retrieved successfully",
		"site_url", siteURL,
		"sitemap_url", sitemapURL)

	return info, nil
}

// SubmitSitemap submits a sitemap to Search Console
func (c *Client) SubmitSitemap(siteURL, sitemapURL string) error {
	if err := validateSiteURL(siteURL); err != nil {
		return err
	}

	if err := validateSitemapURL(sitemapURL); err != nil {
		return err
	}

	if err := c.waitForRateLimit("SubmitSitemap"); err != nil {
		return err
	}

	c.logger.Info("submitting sitemap", "site_url", siteURL, "sitemap_url", sitemapURL)

	err := c.service.Sitemaps.Submit(siteURL, sitemapURL).Do()
	if err != nil {
		c.logger.Error("failed to submit sitemap",
			"site_url", siteURL,
			"sitemap_url", sitemapURL,
			"error", err)
		return fmt.Errorf("failed to submit sitemap %s: %w", sitemapURL, err)
	}

	c.logger.Info("sitemap submitted successfully",
		"site_url", siteURL,
		"sitemap_url", sitemapURL)

	return nil
}

// DeleteSitemap removes a sitemap from Search Console
func (c *Client) DeleteSitemap(siteURL, sitemapURL string) error {
	if err := validateSiteURL(siteURL); err != nil {
		return err
	}

	if err := validateSitemapURL(sitemapURL); err != nil {
		return err
	}

	if err := c.waitForRateLimit("DeleteSitemap"); err != nil {
		return err
	}

	c.logger.Info("deleting sitemap", "site_url", siteURL, "sitemap_url", sitemapURL)

	err := c.service.Sitemaps.Delete(siteURL, sitemapURL).Do()
	if err != nil {
		c.logger.Error("failed to delete sitemap",
			"site_url", siteURL,
			"sitemap_url", sitemapURL,
			"error", err)
		return fmt.Errorf("failed to delete sitemap %s: %w", sitemapURL, err)
	}

	c.logger.Info("sitemap deleted successfully",
		"site_url", siteURL,
		"sitemap_url", sitemapURL)

	return nil
}

// SubmitMultipleSitemaps submits multiple sitemaps to Search Console
func (c *Client) SubmitMultipleSitemaps(siteURL string, sitemapURLs []string) error {
	if err := validateSiteURL(siteURL); err != nil {
		return err
	}

	c.logger.Info("submitting multiple sitemaps",
		"site_url", siteURL,
		"count", len(sitemapURLs))

	for _, sitemapURL := range sitemapURLs {
		if err := c.SubmitSitemap(siteURL, sitemapURL); err != nil {
			return err
		}
	}

	c.logger.Info("all sitemaps submitted successfully",
		"site_url", siteURL,
		"count", len(sitemapURLs))

	return nil
}

// validateSiteURL validates that a site URL is properly formatted
// Supports both URL prefix properties (https://example.com/) and domain properties (sc-domain:example.com)
func validateSiteURL(siteURL string) error {
	if siteURL == "" {
		return fmt.Errorf("site URL cannot be empty")
	}

	// Check if it's a domain property (sc-domain:example.com)
	if strings.HasPrefix(siteURL, "sc-domain:") {
		domain := strings.TrimPrefix(siteURL, "sc-domain:")
		if domain == "" {
			return fmt.Errorf("domain property must include domain after 'sc-domain:': %s", siteURL)
		}
		// Domain property is valid
		return nil
	}

	// Otherwise, it's a URL prefix property - validate as URL
	// Site URL must end with /
	if !strings.HasSuffix(siteURL, "/") {
		return fmt.Errorf("URL prefix property must end with '/': %s", siteURL)
	}

	// Parse URL to validate format
	u, err := url.Parse(siteURL)
	if err != nil {
		return fmt.Errorf("invalid site URL format: %w", err)
	}

	// Must be http or https
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("URL prefix property must use http or https scheme: %s", siteURL)
	}

	return nil
}

// validateSitemapURL validates that a sitemap URL is properly formatted
func validateSitemapURL(sitemapURL string) error {
	if sitemapURL == "" {
		return fmt.Errorf("sitemap URL cannot be empty")
	}

	// Parse URL to validate format
	u, err := url.Parse(sitemapURL)
	if err != nil {
		return fmt.Errorf("invalid sitemap URL format: %w", err)
	}

	// Must be http or https
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("sitemap URL must use http or https scheme: %s", sitemapURL)
	}

	// Typically ends with .xml but not required
	// (can be .xml.gz, sitemap_index.xml, etc.)

	return nil
}
