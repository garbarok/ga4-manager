package cmd

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"

	"github.com/fatih/color"
	"github.com/olekukonko/tablewriter"
	"github.com/spf13/cobra"

	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/garbarok/ga4-manager/internal/gsc"
)

var (
	gscCoverageSite      string
	gscCoverageConfig    string
	gscCoverageDays      int
	gscCoverageFormat    string
	gscCoverageState     string
	gscCoverageTopIssues int
	gscCoverageDryRun    bool
)

var gscCoverageCmd = &cobra.Command{
	Use:   "coverage",
	Short: "Index coverage and indexing statistics",
	Long: `Generate index coverage reports showing indexing status and statistics.

This command estimates index coverage by analyzing search performance data:
- Total pages appearing in search results
- Pages with impressions (indexed)
- Pages with low or no impressions
- Coverage issue breakdown

Note: This is an estimate based on Search Analytics data (last 30 days by default),
not real-time coverage data from the GSC Coverage report.

Output Formats:
  - table (default): Color-coded table view in terminal
  - json: Machine-readable JSON output for automation
  - csv: CSV format for spreadsheet analysis
  - markdown: Human-readable markdown report

Rate Limits:
  - Shares quota with URL inspection (2,000/day)
  - 600 requests per minute per property
  - Rate limiting is automatic

Examples:
  # Generate coverage report for last 30 days
  ga4 gsc coverage --site sc-domain:example.com --days 30

  # Show only low impression pages
  ga4 gsc coverage --site sc-domain:example.com --state low_impressions

  # Generate from config file
  ga4 gsc coverage --config configs/mysite.yaml

  # Export as JSON
  ga4 gsc coverage --config configs/mysite.yaml --format json

  # Limit top issues to 5
  ga4 gsc coverage --site sc-domain:example.com --top-issues 5

  # Dry-run to preview query
  ga4 gsc coverage --site sc-domain:example.com --dry-run

Valid States (for filtering):
  - all: Show all pages (default)
  - indexed: Show only indexed pages (impressions >= 10)
  - low_impressions: Show pages with 1-9 impressions
  - no_impressions: Show pages with 0 impressions`,
}

func init() {
	gscCmd.AddCommand(gscCoverageCmd)

	// Site URL flag (optional if using config)
	gscCoverageCmd.Flags().StringVarP(&gscCoverageSite, "site", "s", "", "Site URL (sc-domain:example.com or https://example.com/)")

	// Config file flag (optional if using --site)
	gscCoverageCmd.Flags().StringVarP(&gscCoverageConfig, "config", "c", "", "Path to configuration file")

	// Days flag (default: 30 days)
	gscCoverageCmd.Flags().IntVarP(&gscCoverageDays, "days", "d", 30, "Number of days to analyze (1-180)")

	// State filter flag
	gscCoverageCmd.Flags().StringVar(&gscCoverageState, "state", "all", "Filter by state: all, indexed, low_impressions, no_impressions")

	// Top issues limit flag
	gscCoverageCmd.Flags().IntVar(&gscCoverageTopIssues, "top-issues", 10, "Number of top issues to display")

	// Format flag (default: table)
	gscCoverageCmd.Flags().StringVarP(&gscCoverageFormat, "format", "f", "table", "Output format: table, json, csv, or markdown")

	// Dry-run flag
	gscCoverageCmd.Flags().BoolVar(&gscCoverageDryRun, "dry-run", false, "Preview query without making API call")

	gscCoverageCmd.RunE = runGSCCoverage
}

func runGSCCoverage(cmd *cobra.Command, args []string) error {
	var siteURL string
	var days int

	// Load from config if provided
	if gscCoverageConfig != "" {
		cfg, err := config.LoadConfig(gscCoverageConfig)
		if err != nil {
			color.Red("✗ Failed to load config: %v", err)
			return err
		}

		if cfg.SearchConsole == nil {
			color.Red("✗ No search_console configuration found in %s", gscCoverageConfig)
			return fmt.Errorf("missing search_console config")
		}

		siteURL = cfg.SearchConsole.SiteURL

		// Use config date range if specified
		if cfg.SearchConsole.SearchAnalytics != nil && cfg.SearchConsole.SearchAnalytics.DateRange != nil && cfg.SearchConsole.SearchAnalytics.DateRange.Days > 0 {
			days = cfg.SearchConsole.SearchAnalytics.DateRange.Days
		} else {
			days = gscCoverageDays
		}
	} else {
		// Use flags directly
		if gscCoverageSite == "" {
			color.Red("✗ Either --site or --config must be provided")
			return fmt.Errorf("missing site URL or config file")
		}

		siteURL = gscCoverageSite
		days = gscCoverageDays
	}

	// Validate inputs
	if err := validateCoverageInputs(siteURL, days, gscCoverageState); err != nil {
		color.Red("✗ Validation failed: %v", err)
		return err
	}

	// Build date range for dry-run display
	startDate, endDate := gsc.BuildDateRange(days)

	// Dry-run mode
	if gscCoverageDryRun {
		displayCoverageDryRun(siteURL, startDate, endDate, gscCoverageState, gscCoverageTopIssues)
		return nil
	}

	// Create client
	client, err := gsc.NewClient()
	if err != nil {
		color.Red("✗ Failed to create GSC client: %v", err)
		return err
	}
	defer func() { _ = client.Close() }()

	// Execute coverage report
	color.Cyan("📊 Generating index coverage report for %s...", siteURL)
	color.Cyan("📅 Analyzing last %d days (%s to %s)", days, startDate, endDate)
	if gscCoverageState != "all" {
		color.Cyan("🔍 Filtering by state: %s", gscCoverageState)
	}
	fmt.Println()

	report, err := client.GetIndexCoverageReportFiltered(siteURL, days, gscCoverageState, gscCoverageTopIssues)
	if err != nil {
		color.Red("✗ Failed to generate coverage report: %v", err)
		return err
	}

	// Display results based on format
	switch gscCoverageFormat {
	case "json":
		displayCoverageJSON(report)
	case "csv":
		displayCoverageCSV(report)
	case "markdown":
		displayCoverageMarkdown(report)
	default:
		displayCoverageTable(report)
	}

	// Display summary and quota status
	if gscCoverageFormat == "table" || gscCoverageFormat == "markdown" {
		displayCoverageSummary(report)
		displayCoverageQuotaStatus(client)
	}

	return nil
}

func validateCoverageInputs(siteURL string, days int, state string) error {
	if siteURL == "" {
		return fmt.Errorf("site URL is required")
	}

	if days < 1 || days > 180 {
		return fmt.Errorf("days must be between 1 and 180, got %d", days)
	}

	validStates := map[string]bool{
		"all":             true,
		"indexed":         true,
		"low_impressions": true,
		"no_impressions":  true,
	}

	if !validStates[state] {
		return fmt.Errorf("invalid state '%s': must be one of: all, indexed, low_impressions, no_impressions", state)
	}

	return nil
}

func displayCoverageDryRun(siteURL, startDate, endDate, state string, topIssues int) {
	color.Cyan("🔍 Dry-run mode - Preview of coverage report query")
	fmt.Println()

	color.White("Site URL:     %s", siteURL)
	color.White("Date Range:   %s to %s", startDate, endDate)
	color.White("State Filter: %s", state)
	color.White("Top Issues:   %d", topIssues)

	fmt.Println()
	color.Yellow("Query Details:")
	color.Yellow("  - Will query Search Analytics with 'page' dimension")
	color.Yellow("  - Maximum 25,000 pages will be analyzed")
	color.Yellow("  - Pages categorized by impression count")
	color.Yellow("  - Results are estimates based on search performance")

	fmt.Println()
	color.Blue("ℹ️  No API call made. Remove --dry-run to execute query.")
}

func displayCoverageTable(report *gsc.IndexCoverageReport) {
	// Display coverage summary
	color.Cyan("═══ Index Coverage Summary ═══")
	fmt.Printf("Total Pages Found:    %s\n", color.BlueString("%d", report.TotalPages))
	fmt.Printf("Indexed Pages:        %s\n", color.GreenString("%d", report.IndexedPages))

	if report.TotalPages > 0 {
		indexedPercent := float64(report.IndexedPages) / float64(report.TotalPages) * 100
		fmt.Printf("Indexed Percentage:   %s\n", color.YellowString("%.1f%%", indexedPercent))
	}
	fmt.Println()

	// Display top issues
	if len(report.TopIssues) > 0 {
		color.Cyan("═══ Coverage Issues ═══")
		issueTable := tablewriter.NewWriter(os.Stdout)
		issueTable.SetHeader([]string{"Issue Type", "Count", "Percentage"})

		// Table styling
		issueTable.SetAutoWrapText(false)
		issueTable.SetAutoFormatHeaders(true)
		issueTable.SetHeaderAlignment(tablewriter.ALIGN_LEFT)
		issueTable.SetAlignment(tablewriter.ALIGN_LEFT)
		issueTable.SetCenterSeparator("")
		issueTable.SetColumnSeparator("")
		issueTable.SetRowSeparator("")
		issueTable.SetHeaderLine(false)
		issueTable.SetBorder(false)
		issueTable.SetTablePadding("\t")
		issueTable.SetNoWhiteSpace(true)

		for _, issue := range report.TopIssues {
			percentage := float64(issue.Count) / float64(report.TotalPages) * 100
			issueTable.Append([]string{
				issue.Issue,
				fmt.Sprintf("%d", issue.Count),
				fmt.Sprintf("%.1f%%", percentage),
			})
		}

		issueTable.Render()
		fmt.Println()
	}

	// Display page samples (limit to first 20 for table view)
	if len(report.PagesSample) > 0 {
		color.Cyan("═══ Page Samples (Top 20) ═══")
		pageTable := tablewriter.NewWriter(os.Stdout)
		pageTable.SetHeader([]string{"URL", "Status", "Impressions", "Clicks", "CTR", "Position"})

		// Table styling
		pageTable.SetAutoWrapText(false)
		pageTable.SetAutoFormatHeaders(true)
		pageTable.SetHeaderAlignment(tablewriter.ALIGN_LEFT)
		pageTable.SetAlignment(tablewriter.ALIGN_LEFT)
		pageTable.SetCenterSeparator("")
		pageTable.SetColumnSeparator("")
		pageTable.SetRowSeparator("")
		pageTable.SetHeaderLine(false)
		pageTable.SetBorder(false)
		pageTable.SetTablePadding("\t")
		pageTable.SetNoWhiteSpace(true)

		displayLimit := len(report.PagesSample)
		if displayLimit > 20 {
			displayLimit = 20
		}

		for i := 0; i < displayLimit; i++ {
			page := report.PagesSample[i]

			// Truncate long URLs
			url := page.URL
			if len(url) > 50 {
				url = url[:47] + "..."
			}

			pageTable.Append([]string{
				url,
				page.Status,
				fmt.Sprintf("%d", page.Impressions),
				fmt.Sprintf("%d", page.Clicks),
				fmt.Sprintf("%.1f%%", page.CTR*100),
				fmt.Sprintf("%.1f", page.Position),
			})
		}

		pageTable.Render()

		if len(report.PagesSample) > 20 {
			fmt.Println()
			color.Blue("  Showing 20 of %d total pages", len(report.PagesSample))
		}
		fmt.Println()
	}
}

func displayCoverageJSON(report *gsc.IndexCoverageReport) {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	_ = encoder.Encode(report)
}

func displayCoverageCSV(report *gsc.IndexCoverageReport) {
	writer := csv.NewWriter(os.Stdout)
	defer writer.Flush()

	// Write header
	_ = writer.Write([]string{"URL", "Status", "Impressions", "Clicks", "CTR", "Position"})

	// Write page samples
	for _, page := range report.PagesSample {
		_ = writer.Write([]string{
			page.URL,
			page.Status,
			fmt.Sprintf("%d", page.Impressions),
			fmt.Sprintf("%d", page.Clicks),
			fmt.Sprintf("%.6f", page.CTR),
			fmt.Sprintf("%.2f", page.Position),
		})
	}
}

func displayCoverageMarkdown(report *gsc.IndexCoverageReport) {
	fmt.Println("# Index Coverage Report")
	fmt.Println()
	fmt.Printf("**Site:** %s  \n", report.SiteURL)
	fmt.Printf("**Period:** %s  \n", report.Period)
	fmt.Println()

	// Summary
	fmt.Println("## Summary")
	fmt.Println()
	fmt.Printf("- **Total Pages:** %d\n", report.TotalPages)
	fmt.Printf("- **Indexed Pages:** %d\n", report.IndexedPages)

	if report.TotalPages > 0 {
		indexedPercent := float64(report.IndexedPages) / float64(report.TotalPages) * 100
		fmt.Printf("- **Indexed Percentage:** %.1f%%\n", indexedPercent)
	}
	fmt.Println()

	// Top Issues
	if len(report.TopIssues) > 0 {
		fmt.Println("## Coverage Issues")
		fmt.Println()
		fmt.Println("| Issue Type | Count | Percentage |")
		fmt.Println("| --- | ---: | ---: |")

		for _, issue := range report.TopIssues {
			percentage := float64(issue.Count) / float64(report.TotalPages) * 100
			fmt.Printf("| %s | %d | %.1f%% |\n", issue.Issue, issue.Count, percentage)
		}
		fmt.Println()
	}

	// Page Samples
	if len(report.PagesSample) > 0 {
		fmt.Println("## Page Samples")
		fmt.Println()
		fmt.Println("| URL | Status | Impressions | Clicks | CTR | Position |")
		fmt.Println("| --- | --- | ---: | ---: | ---: | ---: |")

		// Limit to top 50 for markdown
		displayLimit := len(report.PagesSample)
		if displayLimit > 50 {
			displayLimit = 50
		}

		for i := 0; i < displayLimit; i++ {
			page := report.PagesSample[i]
			fmt.Printf("| %s | %s | %d | %d | %.1f%% | %.1f |\n",
				page.URL,
				page.Status,
				page.Impressions,
				page.Clicks,
				page.CTR*100,
				page.Position,
			)
		}

		if len(report.PagesSample) > 50 {
			fmt.Println()
			fmt.Printf("*Showing top 50 of %d total pages*\n", len(report.PagesSample))
		}
	}
}

func displayCoverageSummary(report *gsc.IndexCoverageReport) {
	fmt.Println()
	color.Cyan("═══ Coverage Report Summary ═══")
	fmt.Printf("Site:           %s\n", report.SiteURL)
	fmt.Printf("Period:         %s\n", report.Period)
	fmt.Printf("Total Pages:    %s\n", color.BlueString("%d", report.TotalPages))
	fmt.Printf("Indexed Pages:  %s\n", color.GreenString("%d", report.IndexedPages))

	if report.TotalPages > 0 {
		indexedPercent := float64(report.IndexedPages) / float64(report.TotalPages) * 100
		var percentColor func(format string, a ...interface{}) string
		if indexedPercent >= 90.0 {
			percentColor = color.GreenString
		} else if indexedPercent >= 70.0 {
			percentColor = color.YellowString
		} else {
			percentColor = color.RedString
		}
		fmt.Printf("Indexed %%:      %s\n", percentColor("%.1f%%", indexedPercent))
	}

	fmt.Println()
	color.Yellow("ℹ️  Note: This is an estimate based on Search Analytics data, not real-time coverage.")
	fmt.Println()
}

func displayCoverageQuotaStatus(client *gsc.Client) {
	used, limit, date := client.GetQuotaStatus()
	percentage := float64(used) / float64(limit) * 100
	remaining := limit - used

	color.Cyan("═══ Daily Quota Status ═══")
	fmt.Printf("Date:           %s\n", date)
	fmt.Printf("Queries Used:   %d / %d (%.1f%%)\n", used, limit, percentage)
	fmt.Printf("Remaining:      %d\n", remaining)
	fmt.Println()

	if percentage >= 95.0 {
		color.Red("🛑 Critical: Approaching daily quota limit!")
	} else if percentage >= 75.0 {
		color.Yellow("⚠️  Warning: %.0f%% of daily quota used", percentage)
	} else {
		color.Green("✓ Quota usage healthy")
	}
	fmt.Println()
}
