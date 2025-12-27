package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// LoadConfig loads a project configuration from a YAML file
func LoadConfig(path string) (*ProjectConfig, error) {
	// Read file
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	// Parse YAML
	var config ProjectConfig
	if err := yaml.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("failed to parse YAML: %w", err)
	}

	// Validate config
	if err := validateConfig(&config); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}

	return &config, nil
}

// LoadConfigByName loads a config from the configs/examples directory by name
// For example: "my-project" loads "configs/examples/my-project.yaml" or "configs/my-project.yaml"
func LoadConfigByName(name string) (*ProjectConfig, error) {
	// Try configs/examples/{name}.yaml
	path := filepath.Join("configs", "examples", name+".yaml")
	if _, err := os.Stat(path); err == nil {
		return LoadConfig(path)
	}

	// Try configs/{name}.yaml
	path = filepath.Join("configs", name+".yaml")
	if _, err := os.Stat(path); err == nil {
		return LoadConfig(path)
	}

	return nil, fmt.Errorf("config not found: %s (looked in configs/ and configs/examples/)", name)
}

// ListAvailableConfigs returns a list of available config files
func ListAvailableConfigs() ([]string, error) {
	var configs []string

	// Check configs/examples/
	examplesPath := filepath.Join("configs", "examples")
	if entries, err := os.ReadDir(examplesPath); err == nil {
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".yaml") {
				name := strings.TrimSuffix(entry.Name(), ".yaml")
				configs = append(configs, name)
			}
		}
	}

	// Check configs/
	configsPath := "configs"
	if entries, err := os.ReadDir(configsPath); err == nil {
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".yaml") {
				name := strings.TrimSuffix(entry.Name(), ".yaml")
				// Don't duplicate if already found in examples
				found := false
				for _, existing := range configs {
					if existing == name {
						found = true
						break
					}
				}
				if !found {
					configs = append(configs, name)
				}
			}
		}
	}

	return configs, nil
}

// validateConfig validates a ProjectConfig
func validateConfig(config *ProjectConfig) error {
	// Validate project info
	if config.Project.Name == "" {
		return fmt.Errorf("project.name is required")
	}

	// Validate GA4 config (only if GA4 features are configured)
	hasGA4Config := config.GA4.PropertyID != "" || len(config.Conversions) > 0 ||
		len(config.Dimensions) > 0 || len(config.Metrics) > 0

	if hasGA4Config && config.GA4.PropertyID == "" {
		return fmt.Errorf("ga4.property_id is required when using GA4 features")
	}

	// Validate conversions
	for i, conv := range config.Conversions {
		if conv.Name == "" {
			return fmt.Errorf("conversions[%d].name is required", i)
		}
		if conv.CountingMethod != "ONCE_PER_SESSION" && conv.CountingMethod != "ONCE_PER_EVENT" {
			return fmt.Errorf("conversions[%d].counting_method must be ONCE_PER_SESSION or ONCE_PER_EVENT", i)
		}
	}

	// Validate dimensions
	for i, dim := range config.Dimensions {
		if dim.Parameter == "" {
			return fmt.Errorf("dimensions[%d].parameter is required", i)
		}
		if dim.DisplayName == "" {
			return fmt.Errorf("dimensions[%d].display_name is required", i)
		}
		if dim.Scope != "USER" && dim.Scope != "EVENT" {
			return fmt.Errorf("dimensions[%d].scope must be USER or EVENT", i)
		}
		// Check for reserved parameters
		if IsReservedParameter(dim.Parameter) {
			return fmt.Errorf("dimensions[%d].parameter '%s' is reserved by GA4 and cannot be used", i, dim.Parameter)
		}
	}

	// Validate metrics
	for i, metric := range config.Metrics {
		if metric.Parameter == "" {
			return fmt.Errorf("metrics[%d].parameter is required", i)
		}
		if metric.DisplayName == "" {
			return fmt.Errorf("metrics[%d].display_name is required", i)
		}
		if metric.Scope != "EVENT" {
			return fmt.Errorf("metrics[%d].scope must be EVENT", i)
		}
		// Note: Unit validation is flexible - GA4 supports various units
	}

	// Validate calculated metrics
	for i, calc := range config.CalculatedMetrics {
		if calc.Name == "" {
			return fmt.Errorf("calculated_metrics[%d].name is required", i)
		}
		if calc.Formula == "" {
			return fmt.Errorf("calculated_metrics[%d].formula is required", i)
		}
	}

	// Validate data retention
	if config.DataRetention != nil {
		validRetentions := map[string]bool{
			"TWO_MONTHS":          true,
			"FOURTEEN_MONTHS":     true,
			"TWENTY_SIX_MONTHS":   true,
			"THIRTY_EIGHT_MONTHS": true,
			"FIFTY_MONTHS":        true,
		}
		if !validRetentions[config.DataRetention.EventDataRetention] {
			return fmt.Errorf("data_retention.event_data_retention must be one of: TWO_MONTHS, FOURTEEN_MONTHS, TWENTY_SIX_MONTHS, THIRTY_EIGHT_MONTHS, FIFTY_MONTHS")
		}
	}

	// Validate SearchConsole configuration
	if config.SearchConsole != nil {
		if err := validateSearchConsoleConfig(config.SearchConsole); err != nil {
			return fmt.Errorf("search_console validation failed: %w", err)
		}
	}

	return nil
}

// validateSearchConsoleConfig validates Search Console configuration
func validateSearchConsoleConfig(sc *SearchConsoleConfig) error {
	// Validate site URL
	if sc.SiteURL == "" {
		return fmt.Errorf("site_url is required")
	}

	// Validate site URL format (supports both sc-domain: and https://)
	if strings.HasPrefix(sc.SiteURL, "sc-domain:") {
		domain := strings.TrimPrefix(sc.SiteURL, "sc-domain:")
		if domain == "" {
			return fmt.Errorf("domain property must include domain after 'sc-domain:': %s", sc.SiteURL)
		}
	} else {
		// URL prefix property must end with /
		if !strings.HasSuffix(sc.SiteURL, "/") {
			return fmt.Errorf("URL prefix property must end with '/': %s", sc.SiteURL)
		}
		// Must be valid URL with http/https
		if !strings.HasPrefix(sc.SiteURL, "http://") && !strings.HasPrefix(sc.SiteURL, "https://") {
			return fmt.Errorf("URL prefix property must use http or https scheme: %s", sc.SiteURL)
		}
	}

	// Validate URL inspection config
	if sc.URLInspection != nil {
		for i, url := range sc.URLInspection.PriorityURLs {
			if url == "" {
				return fmt.Errorf("url_inspection.priority_urls[%d] cannot be empty", i)
			}
			// Validate URL format
			if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
				return fmt.Errorf("url_inspection.priority_urls[%d] must use http or https scheme: %s", i, url)
			}
		}

		// Validate patterns (if any)
		for i, pattern := range sc.URLInspection.Patterns {
			if pattern.Pattern == "" {
				return fmt.Errorf("url_inspection.patterns[%d].pattern is required", i)
			}
		}
	}

	return nil
}

// GetLegacyProject returns a legacy Project struct for backward compatibility
// This allows existing commands to work with the new config format
func GetLegacyProject(name string) (Project, error) {
	// Load from config file
	config, err := LoadConfigByName(name)
	if err != nil {
		return Project{}, fmt.Errorf("config file not found: %s (use --config to specify a YAML config file)", name)
	}

	return config.ConvertToLegacyProject(), nil
}
