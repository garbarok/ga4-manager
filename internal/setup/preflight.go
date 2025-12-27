package setup

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"strings"

	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/garbarok/ga4-manager/internal/ga4"
	"github.com/garbarok/ga4-manager/internal/gsc"
	"github.com/garbarok/ga4-manager/internal/validation"
)

// ValidationResult represents the result of a validation check
type ValidationResult struct {
	Name        string
	Description string
	Status      ValidationStatus
	Error       error
	Warning     string
	Details     string
}

// ValidationStatus represents the status of a validation check
type ValidationStatus int

const (
	ValidationPassed ValidationStatus = iota
	ValidationWarning
	ValidationFailed
	ValidationSkipped
)

// ConflictWarning represents a resource that already exists
type ConflictWarning struct {
	ResourceType string // "conversion", "dimension", "metric", "sitemap"
	ResourceName string
	Message      string
	Action       string // "skip", "update", "error"
}

// PreflightValidator validates configuration and environment before setup
type PreflightValidator struct {
	config    *config.ProjectConfig
	ga4Client *ga4.Client
	gscClient *gsc.Client
	logger    *slog.Logger
	ctx       context.Context
}

// NewPreflightValidator creates a new pre-flight validator
func NewPreflightValidator(
	cfg *config.ProjectConfig,
	ga4Client *ga4.Client,
	gscClient *gsc.Client,
	logger *slog.Logger,
) *PreflightValidator {
	return &PreflightValidator{
		config:    cfg,
		ga4Client: ga4Client,
		gscClient: gscClient,
		logger:    logger,
		ctx:       context.Background(),
	}
}

// ValidateAll runs all pre-flight checks
func (pv *PreflightValidator) ValidateAll() ([]ValidationResult, error) {
	results := []ValidationResult{}

	// 1. Credentials check
	results = append(results, pv.CheckCredentials())

	// 2. Configuration schema validation
	results = append(results, pv.ValidateConfigSchema())

	// 3. GA4 checks (if configured)
	if pv.config.HasAnalytics() {
		results = append(results, pv.CheckGA4Access())
		results = append(results, pv.ValidateGA4Resources())
	}

	// 4. GSC checks (if configured)
	if pv.config.HasSearchConsole() {
		results = append(results, pv.CheckGSCAccess())
		results = append(results, pv.ValidateGSCResources())
		results = append(results, pv.CheckGSCQuota())
	}

	// Check if any critical validation failed
	for _, result := range results {
		if result.Status == ValidationFailed {
			return results, fmt.Errorf("pre-flight validation failed: %s", result.Name)
		}
	}

	return results, nil
}

// CheckCredentials validates Google Cloud credentials
func (pv *PreflightValidator) CheckCredentials() ValidationResult {
	result := ValidationResult{
		Name:        "Credentials",
		Description: "Check Google Cloud credentials",
		Status:      ValidationPassed,
	}

	// Check GOOGLE_APPLICATION_CREDENTIALS environment variable
	credsPath := os.Getenv("GOOGLE_APPLICATION_CREDENTIALS")
	if credsPath == "" {
		result.Status = ValidationFailed
		result.Error = fmt.Errorf("GOOGLE_APPLICATION_CREDENTIALS not set")
		result.Details = "Set environment variable: export GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json"
		return result
	}

	// Check if credentials file exists
	if _, err := os.Stat(credsPath); os.IsNotExist(err) {
		result.Status = ValidationFailed
		result.Error = fmt.Errorf("credentials file not found: %s", credsPath)
		result.Details = "Verify the path points to a valid service account JSON file"
		return result
	}

	result.Details = fmt.Sprintf("Using credentials: %s", credsPath)
	pv.logger.Debug("credentials check passed", "path", credsPath)
	return result
}

// ValidateConfigSchema validates the YAML configuration structure
func (pv *PreflightValidator) ValidateConfigSchema() ValidationResult {
	result := ValidationResult{
		Name:        "Configuration Schema",
		Description: "Validate YAML configuration structure",
		Status:      ValidationPassed,
	}

	// Check project info
	if pv.config.Project.Name == "" {
		result.Status = ValidationFailed
		result.Error = fmt.Errorf("project.name is required")
		return result
	}

	// Validate GA4 config if present
	if pv.config.HasAnalytics() {
		propertyID := pv.config.GetPropertyID()
		if err := validation.ValidatePropertyID(propertyID); err != nil {
			result.Status = ValidationFailed
			result.Error = fmt.Errorf("invalid GA4 property_id: %w", err)
			return result
		}
	}

	// Validate GSC config if present
	if pv.config.HasSearchConsole() {
		siteURL := pv.config.SearchConsole.SiteURL
		if siteURL == "" {
			result.Status = ValidationFailed
			result.Error = fmt.Errorf("search_console.site_url is required")
			return result
		}

		// Validate site URL format
		if !strings.HasPrefix(siteURL, "sc-domain:") && !strings.HasPrefix(siteURL, "http://") && !strings.HasPrefix(siteURL, "https://") {
			result.Status = ValidationFailed
			result.Error = fmt.Errorf("invalid site_url format (must start with sc-domain:, http://, or https://)")
			return result
		}
	}

	// Check that at least one config is present
	if !pv.config.HasAnalytics() && !pv.config.HasSearchConsole() {
		result.Status = ValidationFailed
		result.Error = fmt.Errorf("configuration must include analytics or search_console")
		result.Details = "Add at least one of: analytics{} or search_console{}"
		return result
	}

	result.Details = fmt.Sprintf("Project: %s", pv.config.Project.Name)
	return result
}

// CheckGA4Access validates access to GA4 property
func (pv *PreflightValidator) CheckGA4Access() ValidationResult {
	result := ValidationResult{
		Name:        "GA4 Access",
		Description: "Verify access to GA4 property",
		Status:      ValidationPassed,
	}

	propertyID := pv.config.GetPropertyID()

	// Try to list data streams (quick API call to verify access)
	streams, err := pv.ga4Client.ListDataStreams(propertyID)
	if err != nil {
		result.Status = ValidationFailed
		result.Error = fmt.Errorf("cannot access GA4 property %s: %w", propertyID, err)
		result.Details = "Verify:\n" +
			"  1. Property ID is correct\n" +
			"  2. Service account has Editor/Admin role\n" +
			"  3. Service account email is added to GA4 property"
		return result
	}

	result.Details = fmt.Sprintf("Property %s accessible (%d data streams)", propertyID, len(streams))
	pv.logger.Debug("GA4 access check passed", "property_id", propertyID, "streams", len(streams))
	return result
}

// ValidateGA4Resources validates GA4 resource definitions
func (pv *PreflightValidator) ValidateGA4Resources() ValidationResult {
	result := ValidationResult{
		Name:        "GA4 Resources",
		Description: "Validate GA4 resource definitions",
		Status:      ValidationPassed,
	}

	var errors []string

	// Validate conversions
	for _, conv := range pv.config.Conversions {
		if err := validation.ValidateEventName(conv.Name); err != nil {
			errors = append(errors, fmt.Sprintf("conversion %s: %v", conv.Name, err))
		}
		if err := validation.ValidateCountingMethod(conv.CountingMethod); err != nil {
			errors = append(errors, fmt.Sprintf("conversion %s counting_method: %v", conv.Name, err))
		}
	}

	// Validate dimensions
	for _, dim := range pv.config.Dimensions {
		if err := validation.ValidateParameterName(dim.Parameter); err != nil {
			errors = append(errors, fmt.Sprintf("dimension %s parameter: %v", dim.DisplayName, err))
		}
		if err := validation.ValidateDisplayName(dim.DisplayName); err != nil {
			errors = append(errors, fmt.Sprintf("dimension %s display_name: %v", dim.DisplayName, err))
		}
		if err := validation.ValidateScope(dim.Scope); err != nil {
			errors = append(errors, fmt.Sprintf("dimension %s scope: %v", dim.DisplayName, err))
		}
	}

	// Validate metrics
	for _, metric := range pv.config.Metrics {
		if err := validation.ValidateParameterName(metric.Parameter); err != nil {
			errors = append(errors, fmt.Sprintf("metric %s parameter: %v", metric.DisplayName, err))
		}
		if err := validation.ValidateDisplayName(metric.DisplayName); err != nil {
			errors = append(errors, fmt.Sprintf("metric %s display_name: %v", metric.DisplayName, err))
		}
		if err := validation.ValidateMeasurementUnit(metric.Unit); err != nil {
			errors = append(errors, fmt.Sprintf("metric %s unit: %v", metric.DisplayName, err))
		}
	}

	if len(errors) > 0 {
		result.Status = ValidationFailed
		result.Error = fmt.Errorf("validation errors: %s", strings.Join(errors, "; "))
		return result
	}

	result.Details = fmt.Sprintf("%d conversions, %d dimensions, %d metrics",
		len(pv.config.Conversions), len(pv.config.Dimensions), len(pv.config.Metrics))
	return result
}

// CheckGSCAccess validates access to GSC property
func (pv *PreflightValidator) CheckGSCAccess() ValidationResult {
	result := ValidationResult{
		Name:        "GSC Access",
		Description: "Verify access to Search Console property",
		Status:      ValidationPassed,
	}

	siteURL := pv.config.SearchConsole.SiteURL

	// Try to list sitemaps (quick API call to verify access)
	sitemaps, err := pv.gscClient.ListSitemaps(siteURL)
	if err != nil {
		result.Status = ValidationFailed
		result.Error = fmt.Errorf("cannot access GSC property %s: %w", siteURL, err)
		result.Details = "Verify:\n" +
			"  1. Site URL is correct (use sc-domain: for domain properties)\n" +
			"  2. Site is verified in Search Console\n" +
			"  3. Service account has Owner/Full permission\n" +
			"  4. Service account email is added in GSC Settings → Users"
		return result
	}

	result.Details = fmt.Sprintf("Site %s accessible (%d sitemaps)", siteURL, len(sitemaps))
	pv.logger.Debug("GSC access check passed", "site_url", siteURL, "sitemaps", len(sitemaps))
	return result
}

// ValidateGSCResources validates GSC resource definitions
func (pv *PreflightValidator) ValidateGSCResources() ValidationResult {
	result := ValidationResult{
		Name:        "GSC Resources",
		Description: "Validate GSC resource definitions",
		Status:      ValidationPassed,
	}

	var errors []string
	gscConfig := pv.config.SearchConsole

	// Validate sitemap URLs
	for _, sitemap := range gscConfig.Sitemaps {
		if _, err := url.Parse(sitemap.URL); err != nil {
			errors = append(errors, fmt.Sprintf("invalid sitemap URL %s: %v", sitemap.URL, err))
		}
		if !strings.HasPrefix(sitemap.URL, "http://") && !strings.HasPrefix(sitemap.URL, "https://") {
			errors = append(errors, fmt.Sprintf("sitemap URL must start with http:// or https://: %s", sitemap.URL))
		}
	}

	// Validate priority URLs
	if gscConfig.URLInspection != nil {
		for _, priorityURL := range gscConfig.URLInspection.PriorityURLs {
			if _, err := url.Parse(priorityURL); err != nil {
				errors = append(errors, fmt.Sprintf("invalid priority URL %s: %v", priorityURL, err))
			}
			if !strings.HasPrefix(priorityURL, "http://") && !strings.HasPrefix(priorityURL, "https://") {
				errors = append(errors, fmt.Sprintf("priority URL must start with http:// or https://: %s", priorityURL))
			}
		}
	}

	if len(errors) > 0 {
		result.Status = ValidationFailed
		result.Error = fmt.Errorf("validation errors: %s", strings.Join(errors, "; "))
		return result
	}

	sitemapCount := len(gscConfig.Sitemaps)
	priorityURLCount := 0
	if gscConfig.URLInspection != nil {
		priorityURLCount = len(gscConfig.URLInspection.PriorityURLs)
	}

	result.Details = fmt.Sprintf("%d sitemaps, %d priority URLs", sitemapCount, priorityURLCount)
	return result
}

// CheckGSCQuota validates GSC API quota availability
func (pv *PreflightValidator) CheckGSCQuota() ValidationResult {
	result := ValidationResult{
		Name:        "GSC Quota",
		Description: "Check Search Console API quota",
		Status:      ValidationPassed,
	}

	// Get current quota status
	used, dailyLimit, _ := pv.gscClient.GetQuotaStatus()
	percentage := (float64(used) / float64(dailyLimit)) * 100.0

	// Calculate required quota for this setup
	requiredQuota := 0
	if pv.config.SearchConsole.URLInspection != nil {
		requiredQuota = len(pv.config.SearchConsole.URLInspection.PriorityURLs)
	}

	// Check if we have enough quota
	remainingQuota := dailyLimit - used
	if requiredQuota > remainingQuota {
		result.Status = ValidationWarning
		result.Warning = fmt.Sprintf("insufficient quota: need %d inspections, only %d remaining",
			requiredQuota, remainingQuota)
		result.Details = fmt.Sprintf("Current usage: %d/%d (%.1f%%), resets at midnight",
			used, dailyLimit, percentage)
		pv.logger.Warn("low GSC quota", "used", used, "limit", dailyLimit, "needed", requiredQuota)
		return result
	}

	// Warn if quota is getting low (>75%)
	if percentage > 75.0 {
		result.Status = ValidationWarning
		result.Warning = fmt.Sprintf("quota usage high: %.1f%%", percentage)
	}

	result.Details = fmt.Sprintf("Used: %d/%d (%.1f%%), Remaining: %d",
		used, dailyLimit, percentage, remainingQuota)
	return result
}

// DetectConflicts checks for existing resources that would conflict
func (pv *PreflightValidator) DetectConflicts() ([]ConflictWarning, error) {
	conflicts := []ConflictWarning{}

	// Check GA4 conflicts
	if pv.config.HasAnalytics() {
		propertyID := pv.config.GetPropertyID()

		// Check existing conversions
		existingConversions, err := pv.ga4Client.ListConversions(propertyID)
		if err != nil {
			return nil, fmt.Errorf("list conversions: %w", err)
		}

		conversionMap := make(map[string]bool)
		for _, conv := range existingConversions {
			conversionMap[conv.EventName] = true
		}

		for _, conv := range pv.config.Conversions {
			if conversionMap[conv.Name] {
				conflicts = append(conflicts, ConflictWarning{
					ResourceType: "conversion",
					ResourceName: conv.Name,
					Message:      fmt.Sprintf("Conversion '%s' already exists", conv.Name),
					Action:       "skip",
				})
			}
		}

		// Check existing dimensions
		existingDimensions, err := pv.ga4Client.ListDimensions(propertyID)
		if err != nil {
			return nil, fmt.Errorf("list dimensions: %w", err)
		}

		dimensionMap := make(map[string]bool)
		for _, dim := range existingDimensions {
			dimensionMap[dim.ParameterName] = true
		}

		for _, dim := range pv.config.Dimensions {
			if dimensionMap[dim.Parameter] {
				conflicts = append(conflicts, ConflictWarning{
					ResourceType: "dimension",
					ResourceName: dim.DisplayName,
					Message:      fmt.Sprintf("Dimension '%s' (param: %s) already exists", dim.DisplayName, dim.Parameter),
					Action:       "skip",
				})
			}
		}

		// Check existing metrics
		existingMetrics, err := pv.ga4Client.ListCustomMetrics(propertyID)
		if err != nil {
			return nil, fmt.Errorf("list metrics: %w", err)
		}

		metricMap := make(map[string]bool)
		for _, metric := range existingMetrics {
			metricMap[metric.ParameterName] = true
		}

		for _, metric := range pv.config.Metrics {
			if metricMap[metric.Parameter] {
				conflicts = append(conflicts, ConflictWarning{
					ResourceType: "metric",
					ResourceName: metric.DisplayName,
					Message:      fmt.Sprintf("Metric '%s' (param: %s) already exists", metric.DisplayName, metric.Parameter),
					Action:       "skip",
				})
			}
		}
	}

	// Check GSC conflicts
	if pv.config.HasSearchConsole() {
		siteURL := pv.config.SearchConsole.SiteURL

		// Check existing sitemaps
		existingSitemaps, err := pv.gscClient.ListSitemaps(siteURL)
		if err != nil {
			return nil, fmt.Errorf("list sitemaps: %w", err)
		}

		sitemapMap := make(map[string]bool)
		for _, sitemap := range existingSitemaps {
			sitemapMap[sitemap.Path] = true
		}

		for _, sitemap := range pv.config.SearchConsole.Sitemaps {
			if sitemapMap[sitemap.URL] {
				conflicts = append(conflicts, ConflictWarning{
					ResourceType: "sitemap",
					ResourceName: sitemap.URL,
					Message:      fmt.Sprintf("Sitemap '%s' already submitted", sitemap.URL),
					Action:       "skip",
				})
			}
		}
	}

	return conflicts, nil
}
