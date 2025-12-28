package cmd

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"github.com/fatih/color"
	"github.com/olekukonko/tablewriter"
	"github.com/spf13/cobra"

	"github.com/garbarok/ga4-manager/internal/ga4"
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

func runCleanup(cmd *cobra.Command, args []string) error {
	green := color.New(color.FgGreen).SprintFunc()
	yellow := color.New(color.FgYellow).SprintFunc()
	red := color.New(color.FgRed).SprintFunc()
	blue := color.New(color.FgBlue).SprintFunc()
	cyan := color.New(color.FgCyan).SprintFunc()

	fmt.Println("🧹 GA4 Manager - Cleanup")
	fmt.Println("═══════════════════════════════════════════════")
	fmt.Println()

	if err := validateCleanupType(cleanupType); err != nil {
		return err
	}

	// Create GA4 client
	client, err := ga4.NewClient()
	if err != nil {
		return fmt.Errorf("failed to create GA4 client: %w", err)
	}

	// Load projects based on flags
	projects, err := loadProjects(cleanupConfigPath, cleanupProject, cleanupAllProjects)
	if err != nil {
		return err
	}

	// Process each project
	for _, project := range projects {
		fmt.Printf("\n📦 %s: %s (Property: %s)\n", cyan("Project"), project.Name, project.PropertyID)
		fmt.Println("───────────────────────────────────────────────")

		if project.Cleanup.Reason != "" {
			fmt.Printf("%s %s\n\n", blue("ℹ️"), project.Cleanup.Reason)
		}

		hasConversions := len(project.Cleanup.ConversionsToRemove) > 0 && (cleanupType == "conversions" || cleanupType == "all")
		hasDimensions := len(project.Cleanup.DimensionsToRemove) > 0 && (cleanupType == "dimensions" || cleanupType == "all")
		hasMetrics := len(project.Cleanup.MetricsToRemove) > 0 && (cleanupType == "metrics" || cleanupType == "all")
		hasItems := hasConversions || hasDimensions || hasMetrics

		if !hasItems {
			fmt.Printf("%s No cleanup configured for this project\n", yellow("⚠"))
			continue
		}

		// Show what will be removed
		if hasConversions {
			fmt.Printf("\n%s Conversion Events to Remove:\n", red("🗑"))
			table := tablewriter.NewWriter(os.Stdout)
			table.SetHeader([]string{"Event Name", "Status"})
			table.SetAutoWrapText(false)
			table.SetAlignment(tablewriter.ALIGN_LEFT)

			for _, eventName := range project.Cleanup.ConversionsToRemove {
				table.Append([]string{eventName, "Will be deleted"})
			}
			table.Render()
		}

		if hasDimensions {
			fmt.Printf("\n%s Custom Dimensions to Remove:\n", red("🗑"))
			table := tablewriter.NewWriter(os.Stdout)
			table.SetHeader([]string{"Parameter Name", "Status"})
			table.SetAutoWrapText(false)
			table.SetAlignment(tablewriter.ALIGN_LEFT)

			for _, paramName := range project.Cleanup.DimensionsToRemove {
				table.Append([]string{paramName, "Will be archived"})
			}
			table.Render()
		}

		if hasMetrics {
			fmt.Printf("\n%s Custom Metrics to Remove:\n", red("🗑"))
			table := tablewriter.NewWriter(os.Stdout)
			table.SetHeader([]string{"Parameter Name", "Status"})
			table.SetAutoWrapText(false)
			table.SetAlignment(tablewriter.ALIGN_LEFT)

			for _, paramName := range project.Cleanup.MetricsToRemove {
				table.Append([]string{paramName, "Will be archived"})
			}
			table.Render()
		}

		if cleanupDryRun {
			fmt.Printf("\n%s Dry-run mode enabled - no changes applied\n", yellow("ℹ️"))
			continue
		}

		if !shouldProceedWithCleanup(hasItems, cleanupYes, yellow) {
			fmt.Println("Cleanup cancelled.")
			continue
		}

		// Perform cleanup
		fmt.Println()
		if hasConversions {
			fmt.Printf("%s Removing conversion events...\n", red("🗑"))
			for _, eventName := range project.Cleanup.ConversionsToRemove {
				err := client.DeleteConversion(project.PropertyID, eventName)
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
			for _, paramName := range project.Cleanup.DimensionsToRemove {
				err := client.DeleteDimension(project.PropertyID, paramName)
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
			for _, paramName := range project.Cleanup.MetricsToRemove {
				err := client.DeleteMetric(project.PropertyID, paramName)
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
	if cleanupDryRun {
		fmt.Printf("%s Dry-run complete! No changes were applied.\n", blue("ℹ️"))
	} else {
		fmt.Printf("%s Cleanup complete!\n", green("✅"))
	}
	fmt.Println()
	fmt.Println("Next steps:")
	if cleanupDryRun {
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
