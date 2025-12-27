package cmd

import (
	"fmt"
	"log/slog"
	"os"

	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/garbarok/ga4-manager/internal/ga4"
	"github.com/garbarok/ga4-manager/internal/gsc"
	"github.com/garbarok/ga4-manager/internal/setup"
	"github.com/spf13/cobra"
)

var (
	projectName string
	setupAll    bool
	configPath  string
	setupDryRun bool
)

var setupCmd = &cobra.Command{
	Use:   "setup",
	Short: "Setup GA4 and Google Search Console from YAML configuration",
	Long: `Automatically configure Google Analytics 4 and Google Search Console from a single YAML file.

The setup command provides a unified workflow for:
- Creating GA4 conversions, dimensions, and metrics
- Submitting sitemaps to Google Search Console
- Configuring URL monitoring and search analytics
- Pre-flight validation of credentials and permissions
- Rollback on errors

Supports GA4-only, GSC-only, or combined configurations.`,
	Example: `  # Setup from configuration file (RECOMMENDED)
  ga4 setup --config configs/my-ecommerce.yaml

  # Preview setup without making changes (dry-run)
  ga4 setup --config configs/my-blog.yaml --dry-run

  # Setup all available config files
  ga4 setup --all

  # Setup using config file by name (looks in configs/ and configs/examples/)
  ga4 setup --project basic-ecommerce`,
	RunE: runSetup,
}

func init() {
	rootCmd.AddCommand(setupCmd)
	setupCmd.Flags().StringVarP(&projectName, "project", "p", "", "Config file name (e.g., basic-ecommerce, content-site)")
	setupCmd.Flags().BoolVarP(&setupAll, "all", "a", false, "Setup all projects")
	setupCmd.Flags().StringVarP(&configPath, "config", "c", "", "Path to configuration file (e.g., configs/my-project.yaml)")
	setupCmd.Flags().BoolVar(&setupDryRun, "dry-run", false, "Preview changes without applying them")
}

func runSetup(cmd *cobra.Command, args []string) error {
	// Load configuration
	configs, paths, err := loadProjectConfigs(configPath, projectName, setupAll)
	if err != nil {
		return err
	}

	// Create logger
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: slog.LevelWarn, // Only show warnings and errors during setup
	}))

	// Setup each configuration
	for i, cfg := range configs {
		cfgPath := paths[i]

		// Create clients
		var ga4Client *ga4.Client
		var gscClient *gsc.Client

		// Create GA4 client if needed
		if cfg.HasAnalytics() {
			ga4Client, err = ga4.NewClient()
			if err != nil {
				return fmt.Errorf("failed to create GA4 client: %w", err)
			}
		}

		// Create GSC client if needed
		if cfg.HasSearchConsole() {
			gscClient, err = gsc.NewClient()
			if err != nil {
				return fmt.Errorf("failed to create GSC client: %w", err)
			}
		}

		// Create and execute orchestrator
		orchestrator := setup.NewSetupOrchestrator(cfg, cfgPath, ga4Client, gscClient, logger, setupDryRun)

		if err := orchestrator.Execute(); err != nil {
			return err
		}

		// Add spacing between multiple setups
		if i < len(configs)-1 {
			fmt.Println()
			fmt.Println("═══════════════════════════════════════════════")
			fmt.Println()
		}
	}

	return nil
}

// loadProjectConfigs loads ProjectConfig(s) based on command flags
// Returns configs and their paths for reference in orchestrator
func loadProjectConfigs(configPath, projectName string, loadAll bool) ([]*config.ProjectConfig, []string, error) {
	// Priority 1: Load from config file path
	if configPath != "" {
		cfg, err := config.LoadConfig(configPath)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to load config: %w", err)
		}
		return []*config.ProjectConfig{cfg}, []string{configPath}, nil
	}

	// Priority 2: Load all available configs (for --all flag)
	if loadAll {
		availableConfigs, err := config.ListAvailableConfigs()
		if err != nil || len(availableConfigs) == 0 {
			return nil, nil, fmt.Errorf("no config files found in configs/ or configs/examples/")
		}

		var configs []*config.ProjectConfig
		var paths []string
		for _, name := range availableConfigs {
			cfg, err := config.LoadConfigByName(name)
			if err != nil {
				continue // Skip configs that fail to load
			}
			configs = append(configs, cfg)
			paths = append(paths, fmt.Sprintf("configs/%s.yaml", name))
		}

		if len(configs) == 0 {
			return nil, nil, fmt.Errorf("no valid config files found")
		}

		return configs, paths, nil
	}

	// Priority 3: Load by project name from config files
	if projectName != "" {
		cfg, err := config.LoadConfigByName(projectName)
		if err != nil {
			return nil, nil, fmt.Errorf("config file not found: %s (use --config to specify a YAML config file)", projectName)
		}
		return []*config.ProjectConfig{cfg}, []string{fmt.Sprintf("configs/%s.yaml", projectName)}, nil
	}

	return nil, nil, fmt.Errorf("specify --project <name>, --config <path>, or --all")
}
