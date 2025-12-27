package cmd

import (
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
	gscMonitorConfig string
	gscMonitorDryRun bool
	gscMonitorFormat string
)

var gscMonitorCmd = &cobra.Command{
	Use:   "monitor",
	Short: "Monitor URL indexing status from configuration",
	Long: `Inspect multiple URLs from a configuration file and report their indexing status.

This command reads priority URLs from a YAML configuration file and inspects
each one to check for indexing issues, mobile usability problems, and coverage errors.

Output Formats:
  - table (default): Color-coded table view in terminal
  - json: Machine-readable JSON output
  - markdown: Human-readable markdown report

Rate Limits:
  - 2,000 URL inspections per day
  - 600 inspections per minute per property
  - Rate limiting is automatic

Examples:
  # Dry-run to preview which URLs will be inspected (RECOMMENDED first step)
  ga4 gsc monitor run --config configs/mysite.yaml --dry-run

  # Inspect all priority URLs (table output)
  ga4 gsc monitor run --config configs/mysite.yaml

  # Inspect with JSON output (for automation/CI)
  ga4 gsc monitor run --config configs/mysite.yaml --format json

  # Inspect with Markdown report (for documentation)
  ga4 gsc monitor run --config configs/mysite.yaml --format markdown

Note: Your config should use domain properties (sc-domain:) for best results.
Example config:
  search_console:
    site_url: "sc-domain:example.com"
    url_inspection:
      priority_urls:
        - "https://example.com/"
        - "https://example.com/about"`,
}

var gscMonitorRunCmd = &cobra.Command{
	Use:   "run",
	Short: "Inspect priority URLs from config file",
	Long:  "Load priority URLs from a configuration file and inspect each one for indexing status.",
	RunE:  runGSCMonitor,
}

func init() {
	gscCmd.AddCommand(gscMonitorCmd)
	gscMonitorCmd.AddCommand(gscMonitorRunCmd)

	// Config file flag (required)
	gscMonitorRunCmd.Flags().StringVarP(&gscMonitorConfig, "config", "c", "", "Path to configuration file (e.g., configs/mysite.yaml)")
	_ = gscMonitorRunCmd.MarkFlagRequired("config")

	// Dry-run flag
	gscMonitorRunCmd.Flags().BoolVar(&gscMonitorDryRun, "dry-run", false, "Preview URLs without making API calls")

	// Format flag
	gscMonitorRunCmd.Flags().StringVar(&gscMonitorFormat, "format", "table", "Output format: table, json, or markdown")
}

func runGSCMonitor(cmd *cobra.Command, args []string) error {
	// Load configuration
	cfg, err := config.LoadConfig(gscMonitorConfig)
	if err != nil {
		color.Red("✗ Failed to load config: %v", err)
		return err
	}

	// Validate SearchConsole config exists
	if cfg.SearchConsole == nil {
		color.Red("✗ No search_console configuration found in %s", gscMonitorConfig)
		return fmt.Errorf("missing search_console config")
	}

	// Validate URLInspection config exists
	if cfg.SearchConsole.URLInspection == nil {
		color.Yellow("⚠ No url_inspection configuration found in %s", gscMonitorConfig)
		color.Yellow("Add url_inspection.priority_urls to your config file")
		return nil
	}

	// Get priority URLs
	priorityURLs := cfg.SearchConsole.URLInspection.PriorityURLs
	if len(priorityURLs) == 0 {
		color.Yellow("⚠ No priority URLs configured in url_inspection.priority_urls")
		return nil
	}

	siteURL := cfg.SearchConsole.SiteURL

	// Dry-run mode
	if gscMonitorDryRun {
		displayDryRunPreview(siteURL, priorityURLs)
		return nil
	}

	// Create client
	client, err := gsc.NewClient()
	if err != nil {
		color.Red("✗ Failed to create GSC client: %v", err)
		return err
	}
	defer func() { _ = client.Close() }()

	// Inspect URLs with progress
	color.Cyan("🔍 Inspecting %d priority URLs for %s...", len(priorityURLs), siteURL)
	fmt.Println()

	results, err := client.InspectMultipleURLs(siteURL, priorityURLs)
	if err != nil {
		color.Red("✗ Failed to inspect URLs: %v", err)
		return err
	}

	// Display results based on format
	switch gscMonitorFormat {
	case "json":
		displayJSONResults(results)
	case "markdown":
		displayMarkdownResults(results, siteURL)
	default:
		displayTableResults(results)
	}

	// Summary
	displaySummary(results)

	// Display quota status
	displayQuotaStatus(client)

	return nil
}

func displayDryRunPreview(siteURL string, priorityURLs []string) {
	color.Cyan("═══ Dry-Run Mode ═══")
	fmt.Println()

	color.Cyan("Site: %s", siteURL)
	color.Cyan("URLs to inspect: %d", len(priorityURLs))
	fmt.Println()

	table := tablewriter.NewWriter(os.Stdout)
	table.SetHeader([]string{"#", "URL"})
	table.SetBorder(true)

	for i, url := range priorityURLs {
		table.Append([]string{
			fmt.Sprintf("%d", i+1),
			url,
		})
	}

	table.Render()
	fmt.Println()

	color.Yellow("ℹ️  Dry-run mode enabled - no API calls will be made")
	color.Yellow("ℹ️  Remove --dry-run flag to perform actual inspection")
}

func displayTableResults(results []gsc.URLInspectionResult) {
	color.Cyan("═══ Inspection Results ═══")
	fmt.Println()

	table := tablewriter.NewWriter(os.Stdout)
	table.SetHeader([]string{"URL", "Index Status", "Coverage", "Mobile", "Issues"})
	table.SetBorder(true)
	table.SetRowLine(true)
	table.SetAutoWrapText(false)

	for _, r := range results {
		// Color-coded index status
		status := getColoredStatus(r.IndexStatus)

		// Mobile status
		mobile := getMobileStatus(r.MobileUsable, r.MobileIssues)

		// Issues count
		var issues string
		if len(r.IndexingIssues) > 0 {
			issues = color.RedString("%d", len(r.IndexingIssues))
		} else {
			issues = color.GreenString("0")
		}

		// Truncate URL for display
		url := r.URL
		if len(url) > 60 {
			url = url[:57] + "..."
		}

		table.Append([]string{
			url,
			status,
			r.CoverageState,
			mobile,
			issues,
		})
	}

	table.Render()
	fmt.Println()
}

func displayJSONResults(results []gsc.URLInspectionResult) {
	data, err := json.MarshalIndent(results, "", "  ")
	if err != nil {
		color.Red("✗ Failed to marshal JSON: %v", err)
		return
	}
	fmt.Println(string(data))
}

func displayMarkdownResults(results []gsc.URLInspectionResult, siteURL string) {
	fmt.Println("# URL Inspection Report")
	fmt.Println()
	fmt.Printf("**Site**: %s\n", siteURL)
	fmt.Printf("**Total URLs**: %d\n", len(results))
	fmt.Println()

	// Summary stats
	indexed := 0
	notIndexed := 0
	hasIssues := 0

	for _, r := range results {
		switch r.IndexStatus {
		case "PASS":
			indexed++
		case "FAIL":
			notIndexed++
		}
		if len(r.IndexingIssues) > 0 {
			hasIssues++
		}
	}

	fmt.Println("## Summary")
	fmt.Println()
	fmt.Printf("- ✓ Indexed: %d\n", indexed)
	fmt.Printf("- ✗ Not Indexed: %d\n", notIndexed)
	fmt.Printf("- ⚠ With Issues: %d\n", hasIssues)
	fmt.Println()

	// Detailed results
	fmt.Println("## Detailed Results")
	fmt.Println()

	for i, r := range results {
		fmt.Printf("### %d. %s\n", i+1, r.URL)
		fmt.Println()

		fmt.Printf("- **Index Status**: %s\n", r.IndexStatus)
		fmt.Printf("- **Coverage State**: %s\n", r.CoverageState)
		fmt.Printf("- **Mobile Usable**: %t\n", r.MobileUsable)

		if len(r.IndexingIssues) > 0 {
			fmt.Printf("- **Issues**: %d\n", len(r.IndexingIssues))
			for _, issue := range r.IndexingIssues {
				fmt.Printf("  - [%s] %s: %s\n", issue.Severity, issue.IssueType, issue.Message)
			}
		} else {
			fmt.Println("- **Issues**: None")
		}

		fmt.Println()
	}
}

func displaySummary(results []gsc.URLInspectionResult) {
	indexed := 0
	notIndexed := 0
	partial := 0
	totalIssues := 0

	for _, r := range results {
		switch r.IndexStatus {
		case "PASS":
			indexed++
		case "FAIL":
			notIndexed++
		case "PARTIAL":
			partial++
		}
		totalIssues += len(r.IndexingIssues)
	}

	color.Cyan("═══ Summary ═══")
	fmt.Println()

	if indexed > 0 {
		color.Green("✓ Indexed: %d", indexed)
	}
	if partial > 0 {
		color.Yellow("⚠ Partially Indexed: %d", partial)
	}
	if notIndexed > 0 {
		color.Red("✗ Not Indexed: %d", notIndexed)
	}
	if totalIssues > 0 {
		color.Red("⚠ Total Issues: %d", totalIssues)
	} else {
		color.Green("✓ No Issues Found")
	}
	fmt.Println()
}

func getColoredStatus(status string) string {
	switch status {
	case "PASS":
		return color.GreenString("✓ INDEXED")
	case "FAIL":
		return color.RedString("✗ NOT INDEXED")
	case "PARTIAL":
		return color.YellowString("⚠ PARTIAL")
	default:
		return status
	}
}

func getMobileStatus(usable bool, issues []string) string {
	if usable {
		return color.GreenString("✓ Usable")
	}
	if len(issues) > 0 {
		return color.RedString("✗ Issues (%d)", len(issues))
	}
	return color.YellowString("⚠ Unknown")
}

func displayQuotaStatus(client *gsc.Client) {
	used, limit, date := client.GetQuotaStatus()
	percentage := float64(used) / float64(limit) * 100

	color.Cyan("═══ Daily Quota Status ═══")
	fmt.Println()

	fmt.Printf("Date: %s\n", date)
	fmt.Printf("Inspections Used: %d / %d (%.1f%%)\n", used, limit, percentage)
	fmt.Printf("Remaining: %d\n", limit-used)
	fmt.Println()

	// Visual quota bar
	if percentage >= 95 {
		color.Red("⚠ CRITICAL: Approaching daily limit!")
	} else if percentage >= 75 {
		color.Yellow("⚠ WARNING: %.0f%% of daily quota used", percentage)
	} else {
		color.Green("✓ Quota usage healthy")
	}
	fmt.Println()
}
