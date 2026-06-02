package cmd

import (
	"fmt"
	"strings"

	"os"

	"github.com/fatih/color"
	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/garbarok/ga4-manager/internal/ga4"
	"github.com/garbarok/ga4-manager/internal/tui"
	"github.com/olekukonko/tablewriter"
	tw "github.com/olekukonko/tablewriter/tw"
	"github.com/spf13/cobra"
)

var reportCmd = &cobra.Command{
	Use:   "report",
	Short: "Show quick reports for your projects",
	Long:  `Display current configuration and quick statistics.`,
	RunE:  runReport,
}

var (
	reportAll        bool
	reportConfigPath string
	reportExport     string
	reportOutput     string
)

func init() {
	rootCmd.AddCommand(reportCmd)
	reportCmd.Flags().StringVarP(&projectName, "project", "p", "", "Config file name (e.g., basic-ecommerce, content-site)")
	reportCmd.Flags().BoolVarP(&reportAll, "all", "a", false, "Report on all projects")
	reportCmd.Flags().StringVarP(&reportConfigPath, "config", "c", "", "Path to configuration file")
	reportCmd.Flags().StringVarP(&reportExport, "export", "e", "", "Export format: csv, json, or markdown")
	reportCmd.Flags().StringVarP(&reportOutput, "output", "o", "", "Output file path (default: stdout or auto-generated filename)")
}

// runReport is the Cobra RunE handler — reads flag variables and delegates to executeReport.
func runReport(cmd *cobra.Command, args []string) error {
	return executeReport(reportConfigPath, projectName, reportAll, reportExport, reportOutput)
}

// executeReport performs the report with explicit parameters, avoiding reliance on global flag state.
func executeReport(cfgPath, projName string, all bool, export, output string) error {
	cyan := color.New(color.FgCyan).SprintFunc()

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

	// Handle export mode
	if export != "" {
		return exportReports(client, projects, export, output)
	}

	// Normal display mode
	fmt.Printf("%s GA4 Configuration Report\n", cyan("📊"))
	fmt.Println("═══════════════════════════════════════════════")
	fmt.Println()

	// Report on each project
	for i, project := range projects {
		if i > 0 {
			fmt.Println()
			fmt.Println()
		}

		if err := reportProject(client, project); err != nil {
			return err
		}
	}

	return nil
}

// handleReportAction handles the "View Reports" menu action in interactive mode.
func handleReportAction() {
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
		fmt.Println("\n📊 Loading reports for all projects...")
	} else {
		cfgPath = projectPath
		fmt.Printf("\n📊 Loading report for %s...\n", projectPath)
	}
	fmt.Println()

	if err := executeReport(cfgPath, "", all, "", ""); err != nil {
		fmt.Fprintf(os.Stderr, "\n❌ Error running report: %v\n", err)
		return
	}

	// After displaying, ask if user wants to export
	promptReportExport(projectPath, all)
}

// handleExportAction handles the "Export Reports" menu action in interactive mode.
func handleExportAction() {
	projectPath, err := tui.RunProjectSelector()
	if err != nil {
		if err == tui.ErrBackToMenu || err.Error() == "no project selected" {
			return
		}
		fmt.Fprintf(os.Stderr, "Error selecting project: %v\n", err)
		return
	}

	var all bool
	if projectPath == "--all" {
		all = true
		fmt.Println("\n💾 Exporting reports for all projects...")
	} else {
		fmt.Printf("\n💾 Preparing to export report for %s...\n", projectPath)
	}

	format := promptFormatSelection()
	if format != "" {
		executeExport(projectPath, all, format)
	}
}

// promptFormatSelection prompts user to select export format.
func promptFormatSelection() string {
	fmt.Println("\n" + strings.Repeat("─", 50))
	fmt.Println("\n📦 Select export format:")
	fmt.Println("  1. JSON - Single file with all data")
	fmt.Println("  2. CSV - Multiple files (conversions, dimensions, metrics, etc.)")
	fmt.Println("  3. Markdown - Formatted report with tables")
	fmt.Println("  4. Cancel (return to menu)")
	fmt.Print("\nSelect option (1-4): ")

	var choice string
	_, _ = fmt.Scanln(&choice)

	switch choice {
	case "1":
		return "json"
	case "2":
		return "csv"
	case "3":
		return "markdown"
	case "4", "":
		fmt.Println("\nExport cancelled.")
		return ""
	default:
		fmt.Println("\nInvalid choice. Export cancelled.")
		return ""
	}
}

// promptReportExport prompts the user to export the report after viewing.
func promptReportExport(projectPath string, all bool) {
	fmt.Println("\n" + strings.Repeat("─", 50))
	fmt.Println("\n💾 Would you like to export this report?")
	fmt.Println("  1. Export as JSON")
	fmt.Println("  2. Export as CSV (multiple files)")
	fmt.Println("  3. Export as Markdown")
	fmt.Println("  4. Skip export (return to menu)")
	fmt.Print("\nSelect option (1-4): ")

	var choice string
	_, _ = fmt.Scanln(&choice)

	switch choice {
	case "1":
		executeExport(projectPath, all, "json")
	case "2":
		executeExport(projectPath, all, "csv")
	case "3":
		executeExport(projectPath, all, "markdown")
	case "4", "":
		// Skip export, return to menu
		return
	default:
		fmt.Println("Invalid choice, skipping export.")
	}
}

// executeExport performs the actual export operation.
func executeExport(projectPath string, all bool, format string) {
	fmt.Printf("\n📤 Exporting as %s...\n\n", strings.ToUpper(format))

	// Create GA4 client
	client, err := newGA4Client()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return
	}
	defer client.Close()

	// Load projects
	projects, err := loadProjects(projectPath, "", all)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error loading projects: %v\n", err)
		return
	}

	// Export with auto-generated filename
	if err := exportReports(client, projects, format, ""); err != nil {
		fmt.Fprintf(os.Stderr, "Error exporting report: %v\n", err)
	}
}

// exportReports handles exporting reports in various formats
func exportReports(client *ga4.Client, projects []*config.ProjectConfig, format, outputPath string) error {
	format = strings.ToLower(format)

	// Validate format
	if format != "csv" && format != "json" && format != "markdown" && format != "md" {
		return fmt.Errorf("invalid export format: %s (supported: csv, json, markdown)", format)
	}

	// Normalize markdown format
	if format == "md" {
		format = "markdown"
	}

	fmt.Printf("📤 Exporting reports in %s format...\n\n", strings.ToUpper(format))

	// Export each project
	for _, project := range projects {
		fmt.Printf("Collecting data for %s...\n", project.Project.Name)

		data, err := collectReportData(client, project)
		if err != nil {
			return fmt.Errorf("failed to collect report data for %s: %w", project.Project.Name, err)
		}

		// Generate output path if not specified
		output := outputPath
		if output == "" && len(projects) > 1 {
			output = generateDefaultFilename(project.Project.Name, format)
		} else if output == "" {
			output = generateDefaultFilename(project.Project.Name, format)
		}

		// Export based on format
		switch format {
		case "json":
			if err := exportToJSON(data, output); err != nil {
				return err
			}
		case "csv":
			if err := exportToCSV(data, output); err != nil {
				return err
			}
		case "markdown":
			if err := exportToMarkdown(data, output); err != nil {
				return err
			}
		}

		fmt.Println()
	}

	fmt.Println("✓ Export completed successfully!")
	return nil
}

func reportProject(client *ga4.Client, cfg *config.ProjectConfig) error {
	blue := color.New(color.FgBlue, color.Bold).SprintFunc()

	fmt.Printf("%s %s (Property: %s)\n", blue("📦"), cfg.Project.Name, cfg.GetPropertyID())
	fmt.Println("───────────────────────────────────────────────")
	fmt.Println()

	propertyID := cfg.GetPropertyID()

	// List conversions
	fmt.Println("🎯 Conversions")
	fmt.Println("───────────────────────────────────────────────")
	conversions, err := client.ListConversions(propertyID)
	if err != nil {
		return fmt.Errorf("failed to list conversions: %w", err)
	}

	convTable := tablewriter.NewWriter(os.Stdout)
	convTable.Header([]string{"Event Name", "Counting Method"})
	convTable.Options(tablewriter.WithRendition(tw.Rendition{Borders: tw.BorderNone}))

	for _, conv := range conversions {
		if err := convTable.Append([]string{conv.EventName, conv.CountingMethod}); err != nil {
			return fmt.Errorf("failed to append table row: %w", err)
		}
	}
	if err := convTable.Render(); err != nil {
		return fmt.Errorf("failed to render table: %w", err)
	}

	// List dimensions
	fmt.Println()
	fmt.Println("📊 Custom Dimensions")
	fmt.Println("───────────────────────────────────────────────")
	dimensions, err := client.ListDimensions(propertyID)
	if err != nil {
		return fmt.Errorf("failed to list dimensions: %w", err)
	}

	dimTable := tablewriter.NewWriter(os.Stdout)
	dimTable.Header([]string{"Display Name", "Parameter", "Scope"})
	dimTable.Options(tablewriter.WithRendition(tw.Rendition{Borders: tw.BorderNone}))

	for _, dim := range dimensions {
		if err := dimTable.Append([]string{dim.DisplayName, dim.ParameterName, dim.Scope}); err != nil {
			return fmt.Errorf("failed to append table row: %w", err)
		}
	}
	if err := dimTable.Render(); err != nil {
		return fmt.Errorf("failed to render table: %w", err)
	}

	// List custom metrics
	fmt.Println()
	fmt.Println("📈 Custom Metrics")
	fmt.Println("───────────────────────────────────────────────")
	metrics, err := client.ListCustomMetrics(propertyID)
	if err != nil {
		fmt.Printf("Warning: failed to list custom metrics: %v\n", err)
	} else {
		metricTable := tablewriter.NewWriter(os.Stdout)
		metricTable.Header([]string{"Display Name", "Parameter", "Unit", "Scope"})
		metricTable.Options(tablewriter.WithRendition(tw.Rendition{Borders: tw.BorderNone}))

		for _, metric := range metrics {
			if err := metricTable.Append([]string{metric.DisplayName, metric.ParameterName, metric.MeasurementUnit, metric.Scope}); err != nil {
				return fmt.Errorf("failed to append table row: %w", err)
			}
		}
		if err := metricTable.Render(); err != nil {
			return fmt.Errorf("failed to render table: %w", err)
		}
	}

	// List calculated metrics (recommended)
	fmt.Println()
	fmt.Println("🧮 Recommended Calculated Metrics (create manually in GA4 UI)")
	fmt.Println("───────────────────────────────────────────────")
	calculatedMetrics, err := client.ListCalculatedMetrics(propertyID)
	if err != nil {
		fmt.Printf("Warning: failed to list calculated metrics: %v\n", err)
	} else {
		calcTable := tablewriter.NewWriter(os.Stdout)
		calcTable.Header([]string{"Display Name", "Formula", "Unit"})
		calcTable.Options(tablewriter.WithRendition(tw.Rendition{Borders: tw.BorderNone}))

		for _, calc := range calculatedMetrics {
			if err := calcTable.Append([]string{calc.DisplayName, calc.Formula, calc.MetricUnit}); err != nil {
				return fmt.Errorf("failed to append table row: %w", err)
			}
		}
		if err := calcTable.Render(); err != nil {
			return fmt.Errorf("failed to render table: %w", err)
		}
	}

	// List audiences
	fmt.Println()
	fmt.Println("👥 Configured Audiences")
	fmt.Println("───────────────────────────────────────────────")
	audienceSummary := ga4.GetAudienceSummary(cfg)
	fmt.Println(audienceSummary)

	audienceCategories := ga4.ListAudiencesByCategory(cfg)
	audienceTable := tablewriter.NewWriter(os.Stdout)
	audienceTable.Header([]string{"Name", "Category", "Duration (days)"})
	audienceTable.Options(tablewriter.WithRendition(tw.Rendition{Borders: tw.BorderNone}))

	for _, category := range []string{"SEO", "Conversion", "Content", "Behavioral"} {
		if audiences, ok := audienceCategories[category]; ok {
			for _, aud := range audiences {
				if err := audienceTable.Append([]string{aud.Name, aud.Category, fmt.Sprintf("%d", aud.MembershipDuration)}); err != nil {
					return fmt.Errorf("failed to append table row: %w", err)
				}
			}
		}
	}
	if err := audienceTable.Render(); err != nil {
		return fmt.Errorf("failed to render table: %w", err)
	}

	fmt.Println()
	fmt.Printf("Note: Audiences must be created manually in GA4 UI. Use './ga4 export --audiences' to generate setup guides.\n")

	// Data retention settings
	fmt.Println()
	fmt.Println("🗄️  Data Retention Settings")
	fmt.Println("───────────────────────────────────────────────")
	retentionSettings, err := client.GetDataRetention(propertyID)
	if err != nil {
		fmt.Printf("Warning: failed to get data retention settings: %v\n", err)
	} else {
		retentionMonths := ga4.GetDataRetentionMonths(retentionSettings.EventDataRetention)
		fmt.Printf("Event Data Retention: %d months (%s)\n", retentionMonths, retentionSettings.EventDataRetention)
		fmt.Printf("Reset on New Activity: %t\n", retentionSettings.ResetUserDataOnNewActivity)
	}

	// Enhanced measurement settings
	fmt.Println()
	fmt.Println("⚡ Enhanced Measurement")
	fmt.Println("───────────────────────────────────────────────")
	emSummary, err := client.GetEnhancedMeasurementSummary(propertyID)
	if err != nil {
		fmt.Printf("Warning: failed to get enhanced measurement settings: %v\n", err)
	} else {
		fmt.Print(emSummary)
	}

	return nil
}
