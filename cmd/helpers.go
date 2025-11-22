package cmd

import (
	"fmt"

	"github.com/garbarok/ga4-manager/internal/config"
)

// loadProjects loads projects based on command flags
// Supports --config and --project flags
func loadProjects(configPath, projectName string, loadAll bool) ([]config.Project, error) {
	// Priority 1: Load from config file path
	if configPath != "" {
		cfg, err := config.LoadConfig(configPath)
		if err != nil {
			return nil, fmt.Errorf("failed to load config: %w", err)
		}
		return []config.Project{cfg.ConvertToLegacyProject()}, nil
	}

	// Priority 2: Load all available configs (for --all flag)
	if loadAll {
		availableConfigs, err := config.ListAvailableConfigs()
		if err != nil || len(availableConfigs) == 0 {
			return nil, fmt.Errorf("no config files found in configs/ or configs/examples/")
		}

		var projects []config.Project
		for _, name := range availableConfigs {
			cfg, err := config.LoadConfigByName(name)
			if err != nil {
				continue // Skip configs that fail to load
			}
			projects = append(projects, cfg.ConvertToLegacyProject())
		}

		if len(projects) == 0 {
			return nil, fmt.Errorf("no valid config files found")
		}

		return projects, nil
	}

	// Priority 3: Load by project name from config files
	if projectName != "" {
		cfg, err := config.LoadConfigByName(projectName)
		if err != nil {
			return nil, fmt.Errorf("config file not found: %s (use --config to specify a YAML config file)", projectName)
		}
		return []config.Project{cfg.ConvertToLegacyProject()}, nil
	}

	return nil, fmt.Errorf("specify --project <name>, --config <path>, or --all")
}
