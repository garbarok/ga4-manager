package cmd

import (
	"fmt"

	"github.com/fatih/color"
	"github.com/garbarok/ga4-manager/internal/ga4"
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
	Short: "Setup GA4 configuration for your projects",
	Long:  `Automatically create conversions, custom dimensions, and audiences for your GA4 properties.`,
	Example: `  # Setup from configuration file
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
	green := color.New(color.FgGreen).SprintFunc()
	yellow := color.New(color.FgYellow).SprintFunc()
	red := color.New(color.FgRed).SprintFunc()
	blue := color.New(color.FgBlue).SprintFunc()

	fmt.Println("🚀 GA4 Manager - Setup")
	fmt.Println("═══════════════════════════════════════════════")
	fmt.Println()

	if setupDryRun {
		fmt.Printf("%s Dry-run mode enabled - no changes will be applied\n\n", blue("ℹ️"))
	}

	// Create GA4 client
	client, err := ga4.NewClient()
	if err != nil {
		return fmt.Errorf("failed to create GA4 client: %w", err)
	}

	// Load projects based on flags
	projects, err := loadProjects(configPath, projectName, setupAll)
	if err != nil {
		return err
	}

	// Setup each project
	for _, project := range projects {
		fmt.Printf("\n📦 Setting up: %s (Property: %s)\n", project.Name, project.PropertyID)
		fmt.Println("───────────────────────────────────────────────")

		// Setup conversions
		fmt.Printf("\n🎯 Creating conversions...\n")
		for _, conv := range project.Conversions {
			if setupDryRun {
				fmt.Printf("  %s %s (counting: %s)\n", blue("○"), conv.Name, conv.CountingMethod)
			} else {
				err := client.CreateConversion(project.PropertyID, conv.Name, conv.CountingMethod)
				if err != nil {
					fmt.Printf("  %s %s: %s\n", red("✗"), conv.Name, err)
				} else {
					fmt.Printf("  %s %s\n", green("✓"), conv.Name)
				}
			}
		}

		// Setup dimensions
		fmt.Printf("\n📊 Creating custom dimensions...\n")
		for _, dim := range project.Dimensions {
			if setupDryRun {
				fmt.Printf("  %s %s (param: %s, scope: %s)\n", blue("○"), dim.DisplayName, dim.ParameterName, dim.Scope)
			} else {
				err := client.CreateDimension(project.PropertyID, dim)
				if err != nil {
					fmt.Printf("  %s %s: %s\n", red("✗"), dim.DisplayName, err)
				} else {
					fmt.Printf("  %s %s\n", green("✓"), dim.DisplayName)
				}
			}
		}

		// Setup custom metrics
		fmt.Printf("\n📈 Creating custom metrics...\n")
		for _, metric := range project.Metrics {
			if setupDryRun {
				fmt.Printf("  %s %s (param: %s, scope: %s, unit: %s)\n", blue("○"), metric.DisplayName, metric.EventParameter, metric.Scope, metric.MeasurementUnit)
			} else {
				err := client.CreateCustomMetric(project.PropertyID, metric)
				if err != nil {
					fmt.Printf("  %s %s: %s\n", red("✗"), metric.DisplayName, err)
				} else {
					fmt.Printf("  %s %s\n", green("✓"), metric.DisplayName)
				}
			}
		}

		// Recommend calculated metrics (manual setup required)
		fmt.Printf("\n🧮 Calculated metrics (manual setup required in GA4 UI):\n")
		calcMetrics, _ := client.ListCalculatedMetrics(project.PropertyID)
		for _, calc := range calcMetrics {
			fmt.Printf("  %s %s: %s\n", yellow("○"), calc.DisplayName, calc.Formula)
		}
		fmt.Printf("  ℹ️  Calculated metrics must be created manually in GA4 UI\n")

		// Note about audiences
		fmt.Printf("\n👥 Audiences (manual setup required):\n")
		for _, aud := range project.Audiences {
			fmt.Printf("  %s %s\n", yellow("○"), aud.Name)
		}
		fmt.Printf("  ℹ️  Audiences must be created manually in GA4 UI\n")
	}

	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════")
	if setupDryRun {
		fmt.Printf("%s Dry-run complete! No changes were applied.\n", blue("ℹ️"))
		fmt.Println()
		fmt.Println("Next steps:")
		fmt.Println("1. Review the configuration above")
		fmt.Println("2. Run without --dry-run to apply changes")
	} else {
		fmt.Printf("%s Setup complete!\n", green("✅"))
		fmt.Println()
		fmt.Println("Next steps:")
		fmt.Println("1. Verify in GA4: https://analytics.google.com")
		fmt.Println("2. Implement event tracking in your apps")
		fmt.Println("3. Test events in GA4 DebugView")
	}
	fmt.Println()

	return nil
}
