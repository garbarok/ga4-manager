package cmd

import (
	"fmt"
	"strings"

	"os"

	"github.com/fatih/color"
	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/garbarok/ga4-manager/internal/ga4"
	"github.com/olekukonko/tablewriter"
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

func runReport(cmd *cobra.Command, args []string) error {
	cyan := color.New(color.FgCyan).SprintFunc()

	// Create GA4 client
	client, err := ga4.NewClient()
	if err != nil {
		return fmt.Errorf("failed to create GA4 client: %w", err)
	}

	// Load projects based on flags
	projects, err := loadProjects(reportConfigPath, projectName, reportAll)
	if err != nil {
		return err
	}

	// Handle export mode
	if reportExport != "" {
		return exportReports(client, projects, reportExport, reportOutput)
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

// exportReports handles exporting reports in various formats
func exportReports(client *ga4.Client, projects []config.Project, format, outputPath string) error {
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
		fmt.Printf("Collecting data for %s...\n", project.Name)

		data, err := collectReportData(client, project)
		if err != nil {
			return fmt.Errorf("failed to collect report data for %s: %w", project.Name, err)
		}

		// Generate output path if not specified
		output := outputPath
		if output == "" && len(projects) > 1 {
			output = generateDefaultFilename(project.Name, format)
		} else if output == "" {
			output = generateDefaultFilename(project.Name, format)
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

func reportProject(client *ga4.Client, project config.Project) error {
	blue := color.New(color.FgBlue, color.Bold).SprintFunc()

	fmt.Printf("%s %s (Property: %s)\n", blue("📦"), project.Name, project.PropertyID)
	fmt.Println("───────────────────────────────────────────────")
	fmt.Println()

	// List conversions
	fmt.Println("🎯 Conversions")
	fmt.Println("───────────────────────────────────────────────")
	conversions, err := client.ListConversions(project.PropertyID)
	if err != nil {
		return fmt.Errorf("failed to list conversions: %w", err)
	}

	convTable := tablewriter.NewWriter(os.Stdout)
	convTable.SetHeader([]string{"Event Name", "Counting Method"})
	convTable.SetBorder(false)

	for _, conv := range conversions {
		convTable.Append([]string{conv.EventName, conv.CountingMethod})
	}
	convTable.Render()

	// List dimensions
	fmt.Println()
	fmt.Println("📊 Custom Dimensions")
	fmt.Println("───────────────────────────────────────────────")
	dimensions, err := client.ListDimensions(project.PropertyID)
	if err != nil {
		return fmt.Errorf("failed to list dimensions: %w", err)
	}

	dimTable := tablewriter.NewWriter(os.Stdout)
	dimTable.SetHeader([]string{"Display Name", "Parameter", "Scope"})
	dimTable.SetBorder(false)

	for _, dim := range dimensions {
		dimTable.Append([]string{dim.DisplayName, dim.ParameterName, dim.Scope})
	}
	dimTable.Render()

	// List custom metrics
	fmt.Println()
	fmt.Println("📈 Custom Metrics")
	fmt.Println("───────────────────────────────────────────────")
	metrics, err := client.ListCustomMetrics(project.PropertyID)
	if err != nil {
		fmt.Printf("Warning: failed to list custom metrics: %v\n", err)
	} else {
		metricTable := tablewriter.NewWriter(os.Stdout)
		metricTable.SetHeader([]string{"Display Name", "Parameter", "Unit", "Scope"})
		metricTable.SetBorder(false)

		for _, metric := range metrics {
			metricTable.Append([]string{metric.DisplayName, metric.ParameterName, metric.MeasurementUnit, metric.Scope})
		}
		metricTable.Render()
	}

	// List calculated metrics (recommended)
	fmt.Println()
	fmt.Println("🧮 Recommended Calculated Metrics (create manually in GA4 UI)")
	fmt.Println("───────────────────────────────────────────────")
	calculatedMetrics, err := client.ListCalculatedMetrics(project.PropertyID)
	if err != nil {
		fmt.Printf("Warning: failed to list calculated metrics: %v\n", err)
	} else {
		calcTable := tablewriter.NewWriter(os.Stdout)
		calcTable.SetHeader([]string{"Display Name", "Formula", "Unit"})
		calcTable.SetBorder(false)
		calcTable.SetColWidth(50)

		for _, calc := range calculatedMetrics {
			calcTable.Append([]string{calc.DisplayName, calc.Formula, calc.MetricUnit})
		}
		calcTable.Render()
	}

	// List audiences
	fmt.Println()
	fmt.Println("👥 Configured Audiences")
	fmt.Println("───────────────────────────────────────────────")
	audienceSummary := ga4.GetAudienceSummary(project)
	fmt.Println(audienceSummary)

	audienceCategories := ga4.ListAudiencesByCategory(project)
	audienceTable := tablewriter.NewWriter(os.Stdout)
	audienceTable.SetHeader([]string{"Name", "Category", "Duration (days)"})
	audienceTable.SetBorder(false)

	for _, category := range []string{"SEO", "Conversion", "Content", "Behavioral"} {
		if audiences, ok := audienceCategories[category]; ok {
			for _, aud := range audiences {
				audienceTable.Append([]string{aud.Name, aud.Category, fmt.Sprintf("%d", aud.MembershipDuration)})
			}
		}
	}
	audienceTable.Render()

	fmt.Println()
	fmt.Printf("Note: Audiences must be created manually in GA4 UI. Use './ga4 export --audiences' to generate setup guides.\n")

	// Data retention settings
	fmt.Println()
	fmt.Println("🗄️  Data Retention Settings")
	fmt.Println("───────────────────────────────────────────────")
	retentionSettings, err := client.GetDataRetention(project.PropertyID)
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
	emSummary, err := client.GetEnhancedMeasurementSummary(project.PropertyID)
	if err != nil {
		fmt.Printf("Warning: failed to get enhanced measurement settings: %v\n", err)
	} else {
		fmt.Print(emSummary)
	}

	return nil
}
