package cmd

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"github.com/fatih/color"
	"github.com/garbarok/ga4-manager/internal/tui"
	"github.com/olekukonko/tablewriter"
	tw "github.com/olekukonko/tablewriter/tw"
	"github.com/spf13/cobra"
)

var (
	cleanupDryRun      bool
	cleanupType        string
	cleanupYes         bool
	cleanupProject     string
	cleanupAllProjects bool
	cleanupConfigPath  string
)

var cleanupCmd = &cobra.Command{
	Use:   "cleanup",
	Short: "Remove unused events and dimensions from GA4",
	Long: `Remove conversion events, custom dimensions, and custom metrics that are not implemented in your tracking code.
This helps reduce noise, improve data quality, and free up GA4 property quota.`,
	Example: `  # Preview cleanup (dry-run)
  ga4 cleanup --config configs/my-blog.yaml --dry-run

  # Remove unused conversions only
  ga4 cleanup --config configs/my-blog.yaml --type conversions

  # Remove unused metrics only
  ga4 cleanup --config configs/my-blog.yaml --type metrics

  # Remove conversions, dimensions, and metrics (everything)
  ga4 cleanup --config configs/my-blog.yaml --type all

  # Skip confirmation prompt
  ga4 cleanup --config configs/my-blog.yaml --yes

  # Cleanup all available config files
  ga4 cleanup --all --dry-run`,
	RunE: runCleanup,
}

func init() {
	rootCmd.AddCommand(cleanupCmd)
	cleanupCmd.Flags().StringVarP(&cleanupProject, "project", "p", "", "Config file name (e.g., basic-ecommerce, content-site)")
	cleanupCmd.Flags().BoolVarP(&cleanupAllProjects, "all", "a", false, "Cleanup all projects")
	cleanupCmd.Flags().StringVarP(&cleanupConfigPath, "config", "c", "", "Path to configuration file")
	cleanupCmd.Flags().BoolVar(&cleanupDryRun, "dry-run", false, "Preview changes without applying them")
	cleanupCmd.Flags().StringVarP(&cleanupType, "type", "t", "all", "What to cleanup: conversions, dimensions, metrics, all")
	cleanupCmd.Flags().BoolVarP(&cleanupYes, "yes", "y", false, "Skip confirmation prompt")
}

// runCleanup is the Cobra RunE handler — reads flag variables and delegates to executeCleanup.
func runCleanup(cmd *cobra.Command, args []string) error {
	return executeCleanup(cleanupConfigPath, cleanupProject, cleanupAllProjects, cleanupDryRun, cleanupType, cleanupYes)
}

// executeCleanup performs the cleanup with explicit parameters, avoiding reliance on global flag state.
func executeCleanup(cfgPath, projName string, all, dryRun bool, cType string, yes bool) error {
	green := color.New(color.FgGreen).SprintFunc()
	yellow := color.New(color.FgYellow).SprintFunc()
	red := color.New(color.FgRed).SprintFunc()
	blue := color.New(color.FgBlue).SprintFunc()
	cyan := color.New(color.FgCyan).SprintFunc()

	fmt.Println("🧹 GA4 Manager - Cleanup")
	fmt.Println("═══════════════════════════════════════════════")
	fmt.Println()

	if err := validateCleanupType(cType); err != nil {
		return err
	}

	// Create GA4 client
	client, err := newGA4Client()
	if err != nil {
		return err
	}
	defer client.Close()

	// Load projects based on flags
	projects, err := loadProjects(cfgPath, projName, all)
	if err != nil {
		return err
	}

	// Process each project
	for _, cfg := range projects {
		propertyID := cfg.GetPropertyID()
		fmt.Printf("\n📦 %s: %s (Property: %s)\n", cyan("Project"), cfg.Project.Name, propertyID)
		fmt.Println("───────────────────────────────────────────────")

		if cfg.Cleanup.Reason != "" {
			fmt.Printf("%s %s\n\n", blue("ℹ️"), cfg.Cleanup.Reason)
		}

		hasConversions := len(cfg.Cleanup.ConversionsToRemove) > 0 && (cType == "conversions" || cType == "all")
		hasDimensions := len(cfg.Cleanup.DimensionsToRemove) > 0 && (cType == "dimensions" || cType == "all")
		hasMetrics := len(cfg.Cleanup.MetricsToRemove) > 0 && (cType == "metrics" || cType == "all")
		hasItems := hasConversions || hasDimensions || hasMetrics

		if !hasItems {
			fmt.Printf("%s No cleanup configured for this project\n", yellow("⚠"))
			continue
		}

		// Show what will be removed
		if hasConversions {
			fmt.Printf("\n%s Conversion Events to Remove:\n", red("🗑"))
			table := tablewriter.NewWriter(os.Stdout)
			table.Header([]string{"Event Name", "Status"})
			table.Options(tablewriter.WithRowAlignment(tw.AlignLeft))

			for _, eventName := range cfg.Cleanup.ConversionsToRemove {
				if err := table.Append([]string{eventName, "Will be deleted"}); err != nil {
					return fmt.Errorf("failed to append table row: %w", err)
				}
			}
			if err := table.Render(); err != nil {
				return fmt.Errorf("failed to render table: %w", err)
			}
		}

		if hasDimensions {
			fmt.Printf("\n%s Custom Dimensions to Remove:\n", red("🗑"))
			table := tablewriter.NewWriter(os.Stdout)
			table.Header([]string{"Parameter Name", "Status"})
			table.Options(tablewriter.WithRowAlignment(tw.AlignLeft))

			for _, paramName := range cfg.Cleanup.DimensionsToRemove {
				if err := table.Append([]string{paramName, "Will be archived"}); err != nil {
					return fmt.Errorf("failed to append table row: %w", err)
				}
			}
			if err := table.Render(); err != nil {
				return fmt.Errorf("failed to render table: %w", err)
			}
		}

		if hasMetrics {
			fmt.Printf("\n%s Custom Metrics to Remove:\n", red("🗑"))
			table := tablewriter.NewWriter(os.Stdout)
			table.Header([]string{"Parameter Name", "Status"})
			table.Options(tablewriter.WithRowAlignment(tw.AlignLeft))

			for _, paramName := range cfg.Cleanup.MetricsToRemove {
				if err := table.Append([]string{paramName, "Will be archived"}); err != nil {
					return fmt.Errorf("failed to append table row: %w", err)
				}
			}
			if err := table.Render(); err != nil {
				return fmt.Errorf("failed to render table: %w", err)
			}
		}

		if dryRun {
			fmt.Printf("\n%s Dry-run mode enabled - no changes applied\n", yellow("ℹ️"))
			continue
		}

		if !shouldProceedWithCleanup(hasItems, yes, yellow) {
			fmt.Println("Cleanup cancelled.")
			continue
		}

		// Perform cleanup
		fmt.Println()
		if hasConversions {
			fmt.Printf("%s Removing conversion events...\n", red("🗑"))
			for _, eventName := range cfg.Cleanup.ConversionsToRemove {
				err := client.DeleteConversion(propertyID, eventName)
				if err != nil {
					if strings.Contains(err.Error(), "not found") {
						fmt.Printf("  %s %s (already removed)\n", yellow("○"), eventName)
					} else {
						fmt.Printf("  %s %s: %s\n", red("✗"), eventName, err)
					}
				} else {
					fmt.Printf("  %s %s\n", green("✓"), eventName)
				}
			}
		}

		if hasDimensions {
			fmt.Printf("\n%s Archiving custom dimensions...\n", red("🗑"))
			for _, paramName := range cfg.Cleanup.DimensionsToRemove {
				err := client.DeleteDimension(propertyID, paramName)
				if err != nil {
					if strings.Contains(err.Error(), "not found") {
						fmt.Printf("  %s %s (already archived)\n", yellow("○"), paramName)
					} else {
						fmt.Printf("  %s %s: %s\n", red("✗"), paramName, err)
					}
				} else {
					fmt.Printf("  %s %s\n", green("✓"), paramName)
				}
			}
		}

		if hasMetrics {
			fmt.Printf("\n%s Archiving custom metrics...\n", red("🗑"))
			for _, paramName := range cfg.Cleanup.MetricsToRemove {
				err := client.DeleteMetric(propertyID, paramName)
				if err != nil {
					if strings.Contains(err.Error(), "not found") {
						fmt.Printf("  %s %s (already archived)\n", yellow("○"), paramName)
					} else {
						fmt.Printf("  %s %s: %s\n", red("✗"), paramName, err)
					}
				} else {
					fmt.Printf("  %s %s\n", green("✓"), paramName)
				}
			}
		}
	}

	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════")
	if dryRun {
		fmt.Printf("%s Dry-run complete! No changes were applied.\n", blue("ℹ️"))
	} else {
		fmt.Printf("%s Cleanup complete!\n", green("✅"))
	}
	fmt.Println()
	fmt.Println("Next steps:")
	if dryRun {
		fmt.Println("1. Review the changes above")
		fmt.Println("2. Run without --dry-run to apply changes")
	} else {
		fmt.Println("1. Verify in GA4: https://analytics.google.com")
		fmt.Println("2. Run 'ga4 report' to see updated configuration")
		fmt.Println("3. Historical data for removed events is preserved")
	}
	fmt.Println()

	return nil
}

// handleCleanupAction handles the "Cleanup Unused Items" menu action in interactive mode.
func handleCleanupAction() {
	projectPath, err := tui.RunProjectSelector()
	if err != nil {
		if err == tui.ErrBackToMenu || err.Error() == "no project selected" {
			return
		}
		fmt.Fprintf(os.Stderr, "Error selecting project: %v\n", err)
		return
	}

	var cfgPath string
	var all bool

	if projectPath == "--all" {
		all = true
	} else {
		cfgPath = projectPath
	}

	fmt.Println("\n🧹 Running cleanup in dry-run mode (preview only)...")
	fmt.Println("To apply changes, use: ga4 cleanup --config", projectPath)
	fmt.Println()

	if err := executeCleanup(cfgPath, "", all, true, "all", false); err != nil {
		fmt.Fprintf(os.Stderr, "Error running cleanup: %v\n", err)
	}
}

// validateCleanupType ensures cleanup type is valid.
func validateCleanupType(cleanupType string) error {
	validTypes := []string{"conversions", "dimensions", "metrics", "all"}
	for _, vt := range validTypes {
		if cleanupType == vt {
			return nil
		}
	}
	return fmt.Errorf("invalid type '%s': must be one of %v", cleanupType, validTypes)
}

// shouldProceedWithCleanup determines if cleanup should proceed.
func shouldProceedWithCleanup(hasItems, skipConfirmation bool, yellow func(a ...interface{}) string) bool {
	if !hasItems {
		return false
	}

	if skipConfirmation {
		return true
	}

	fmt.Printf("\n%s This will permanently remove/archive the items shown above.\n", yellow("⚠"))
	fmt.Print("Do you want to continue? [y/N]: ")

	reader := bufio.NewReader(os.Stdin)
	response, err := reader.ReadString('\n')
	if err != nil {
		return false
	}

	response = strings.ToLower(strings.TrimSpace(response))
	return response == "y" || response == "yes"
}
