package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/fatih/color"
	"github.com/spf13/cobra"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"

	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/garbarok/ga4-manager/internal/gsc"
	"github.com/garbarok/ga4-manager/internal/render"
)

var (
	gscAnalyticsSite       string
	gscAnalyticsConfig     string
	gscAnalyticsDays       int
	gscAnalyticsDimensions string
	gscAnalyticsFormat     string
	gscAnalyticsDryRun     bool
	gscAnalyticsRowLimit   int
)

var gscAnalyticsCmd = &cobra.Command{
	Use:   "analytics",
	Short: "Search analytics and performance reporting",
	Long: `Generate reports on search performance showing how users find your site on Google.

Query search analytics data including:
- Top search queries bringing traffic
- Top landing pages from search
- Click-through rates (CTR)
- Average positions in search results
- Geographic breakdown (by country)
- Device breakdown (desktop, mobile, tablet)

Output Formats:
  - table (default): Color-coded table view in terminal
  - json: Machine-readable JSON output for automation
  - csv: CSV format for spreadsheet analysis
  - markdown: Human-readable markdown report

Data Availability:
  - Up to 16 months of historical data
  - Data is typically 2-3 days behind
  - Final (fully processed) data is used by default

Rate Limits:
  - Shares quota with URL inspection (2,000/day)
  - 600 requests per minute per property
  - Rate limiting is automatic

Examples:
  # Generate report for last 30 days (default dimensions: query, page)
  ga4 gsc analytics run --site sc-domain:example.com --days 30

  # Report with specific dimensions
  ga4 gsc analytics run --site sc-domain:example.com --days 7 --dimensions query,page,country

  # Generate from config file (recommended)
  ga4 gsc analytics run --config configs/mysite.yaml

  # Export as CSV for Excel/Sheets
  ga4 gsc analytics run --config configs/mysite.yaml --format csv > report.csv

  # Export as JSON for automation
  ga4 gsc analytics run --config configs/mysite.yaml --format json

  # Dry-run to preview query
  ga4 gsc analytics run --config configs/mysite.yaml --dry-run

Valid Dimensions (max 3):
  - query: Search queries
  - page: Landing pages
  - country: Country codes (e.g., usa, gbr, fra)
  - device: Device types (desktop, mobile, tablet)
  - searchAppearance: How the result appeared (e.g., organic, news)
  - date: Date for trend analysis`,
}

var gscAnalyticsRunCmd = &cobra.Command{
	Use:   "run",
	Short: "Generate search analytics report",
	Long:  "Query search analytics data and generate a performance report.",
	RunE:  runGSCAnalytics,
}

func init() {
	gscCmd.AddCommand(gscAnalyticsCmd)
	gscAnalyticsCmd.AddCommand(gscAnalyticsRunCmd)

	// Site URL flag (optional if using config)
	gscAnalyticsRunCmd.Flags().StringVarP(&gscAnalyticsSite, "site", "s", "", "Site URL (sc-domain:example.com or https://example.com/)")

	// Config file flag (optional if using --site)
	gscAnalyticsRunCmd.Flags().StringVarP(&gscAnalyticsConfig, "config", "c", "", "Path to configuration file")

	// Days flag (default: 30 days)
	gscAnalyticsRunCmd.Flags().IntVarP(&gscAnalyticsDays, "days", "d", 30, "Number of days to query (1-180)")

	// Dimensions flag (default: query,page)
	gscAnalyticsRunCmd.Flags().StringVar(&gscAnalyticsDimensions, "dimensions", "query,page", "Dimensions to include (comma-separated, max 3)")

	// Row limit flag (default: 100)
	gscAnalyticsRunCmd.Flags().IntVarP(&gscAnalyticsRowLimit, "limit", "l", 100, "Maximum rows to return (1-25000)")

	// Format flag (default: table)
	gscAnalyticsRunCmd.Flags().StringVarP(&gscAnalyticsFormat, "format", "f", "table", "Output format: table, json, csv, or markdown")

	// Dry-run flag
	gscAnalyticsRunCmd.Flags().BoolVar(&gscAnalyticsDryRun, "dry-run", false, "Preview query without making API call")
}

func runGSCAnalytics(cmd *cobra.Command, args []string) error {
	var siteURL string
	var dimensions []string
	var days int
	var rowLimit int

	// Load from config if provided
	if gscAnalyticsConfig != "" {
		cfg, err := config.LoadConfig(gscAnalyticsConfig)
		if err != nil {
			color.Red("✗ Failed to load config: %v", err)
			return err
		}

		if cfg.SearchConsole == nil {
			color.Red("✗ No search_console configuration found in %s", gscAnalyticsConfig)
			return fmt.Errorf("missing search_console config")
		}

		siteURL = cfg.SearchConsole.SiteURL

		// Use config values if analytics config exists
		if cfg.SearchConsole.SearchAnalytics != nil {
			// Use config date range if specified
			if cfg.SearchConsole.SearchAnalytics.DateRange != nil && cfg.SearchConsole.SearchAnalytics.DateRange.Days > 0 {
				days = cfg.SearchConsole.SearchAnalytics.DateRange.Days
			} else {
				days = gscAnalyticsDays
			}

			// Use config dimensions if specified
			if len(cfg.SearchConsole.SearchAnalytics.Dimensions) > 0 {
				dimensions = cfg.SearchConsole.SearchAnalytics.Dimensions
			} else {
				dimensions = strings.Split(gscAnalyticsDimensions, ",")
			}

			// Row limit (use default if not in config)
			rowLimit = gscAnalyticsRowLimit
		} else {
			// No analytics config, use flag defaults
			days = gscAnalyticsDays
			dimensions = strings.Split(gscAnalyticsDimensions, ",")
			rowLimit = gscAnalyticsRowLimit
		}
	} else {
		// Use flags directly
		if gscAnalyticsSite == "" {
			color.Red("✗ Either --site or --config must be provided")
			return fmt.Errorf("missing site URL or config file")
		}

		siteURL = gscAnalyticsSite
		days = gscAnalyticsDays
		dimensions = strings.Split(gscAnalyticsDimensions, ",")
		rowLimit = gscAnalyticsRowLimit
	}

	// Trim whitespace from dimensions
	for i := range dimensions {
		dimensions[i] = strings.TrimSpace(dimensions[i])
	}

	// Validate inputs
	if err := gsc.ValidateAnalyticsParams(siteURL, days, dimensions, rowLimit); err != nil {
		color.Red("✗ Validation failed: %v", err)
		return err
	}

	// Build date range
	startDate, endDate := gsc.BuildDateRange(days)

	// Build query
	query := &gsc.SearchAnalyticsQuery{
		SiteURL:    siteURL,
		StartDate:  startDate,
		EndDate:    endDate,
		Dimensions: dimensions,
		RowLimit:   rowLimit,
		DataState:  "final",
	}

	// Dry-run mode
	if gscAnalyticsDryRun {
		displayAnalyticsDryRun(query)
		return nil
	}

	// Create client
	client, err := gsc.NewClient()
	if err != nil {
		color.Red("✗ Failed to create GSC client: %v", err)
		return err
	}
	defer func() { _ = client.Close() }()

	// Execute query
	color.Cyan("📊 Querying search analytics for %s...", siteURL)
	color.Cyan("📅 Date range: %s to %s (%d days)", startDate, endDate, days)
	color.Cyan("📈 Dimensions: %s", strings.Join(dimensions, ", "))
	fmt.Println()

	report, err := client.QuerySearchAnalytics(query)
	if err != nil {
		color.Red("✗ Failed to query search analytics: %v", err)
		return err
	}

	// Display results based on format
	switch gscAnalyticsFormat {
	case "json":
		displayAnalyticsJSON(report)
	case "csv":
		displayAnalyticsCSV(report)
	case "markdown":
		displayAnalyticsMarkdown(report)
	default:
		if err := displayAnalyticsTable(report); err != nil {
			return err
		}
	}

	// Display summary and quota status
	if gscAnalyticsFormat == "table" || gscAnalyticsFormat == "markdown" {
		displayAnalyticsSummary(report)
		displayAnalyticsQuotaStatus(client)
	}

	return nil
}

func displayAnalyticsDryRun(query *gsc.SearchAnalyticsQuery) {
	color.Cyan("🔍 Dry-run mode - Preview of search analytics query")
	fmt.Println()

	color.White("Site URL:     %s", query.SiteURL)
	color.White("Date Range:   %s to %s", query.StartDate, query.EndDate)
	color.White("Dimensions:   %s", strings.Join(query.Dimensions, ", "))
	color.White("Row Limit:    %d", query.RowLimit)
	color.White("Data State:   %s", query.DataState)

	if len(query.Filters) > 0 {
		fmt.Println()
		color.Yellow("Filters:")
		for i, filter := range query.Filters {
			color.Yellow("  %d. %s %s '%s'", i+1, filter.Dimension, filter.Operator, filter.Expression)
		}
	}

	fmt.Println()
	color.Blue("ℹ️  No API call made. Remove --dry-run to execute query.")
}

// analyticsColumns builds the column list from the report's dimensions plus
// the four fixed metric columns. Title-casing the dimension names matches the
// previous hand-rolled headers.
func analyticsColumns(report *gsc.SearchAnalyticsReport) []string {
	columns := make([]string, 0, len(report.Metadata.Dimensions)+4)
	for _, dim := range report.Metadata.Dimensions {
		columns = append(columns, cases.Title(language.English).String(dim))
	}
	return append(columns, "Clicks", "Impressions", "CTR", "Position")
}

// analyticsTableRow truncates long dimension values for terminal display and
// uses one-decimal precision on CTR and position.
func analyticsTableRow(row gsc.SearchAnalyticsRow) []string {
	cells := make([]string, 0, len(row.Keys)+4)
	for _, k := range row.Keys {
		if len(k) > 60 {
			cells = append(cells, k[:57]+"...")
		} else {
			cells = append(cells, k)
		}
	}
	return append(cells,
		fmt.Sprintf("%d", row.Clicks),
		fmt.Sprintf("%d", row.Impressions),
		fmt.Sprintf("%.1f%%", row.CTR*100),
		fmt.Sprintf("%.1f", row.Position),
	)
}

// analyticsCSVRow keeps dimension values verbatim and emits CTR / position at
// full precision so downstream spreadsheet/BI tools can reformat.
func analyticsCSVRow(row gsc.SearchAnalyticsRow) []string {
	cells := make([]string, 0, len(row.Keys)+4)
	cells = append(cells, row.Keys...)
	return append(cells,
		fmt.Sprintf("%d", row.Clicks),
		fmt.Sprintf("%d", row.Impressions),
		fmt.Sprintf("%.6f", row.CTR),
		fmt.Sprintf("%.2f", row.Position),
	)
}

// analyticsMarkdownRow matches the table-mode precision; pipe escaping is
// handled inside the render package.
func analyticsMarkdownRow(row gsc.SearchAnalyticsRow) []string {
	cells := make([]string, 0, len(row.Keys)+4)
	cells = append(cells, row.Keys...)
	return append(cells,
		fmt.Sprintf("%d", row.Clicks),
		fmt.Sprintf("%d", row.Impressions),
		fmt.Sprintf("%.1f%%", row.CTR*100),
		fmt.Sprintf("%.1f", row.Position),
	)
}

func displayAnalyticsTable(report *gsc.SearchAnalyticsReport) error {
	if report.TotalRows == 0 {
		color.Yellow("⚠ No data found for this query")
		return nil
	}
	return render.Render(os.Stdout, render.FormatTable, analyticsColumns(report), report.Rows, analyticsTableRow)
}

func displayAnalyticsJSON(report *gsc.SearchAnalyticsReport) {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	_ = encoder.Encode(report)
}

func displayAnalyticsCSV(report *gsc.SearchAnalyticsReport) {
	_ = render.Render(os.Stdout, render.FormatCSV, analyticsColumns(report), report.Rows, analyticsCSVRow)
}

func displayAnalyticsMarkdown(report *gsc.SearchAnalyticsReport) {
	fmt.Println("# Search Analytics Report")
	fmt.Println()
	fmt.Printf("**Site:** %s  \n", report.SiteURL)
	fmt.Printf("**Period:** %s  \n", report.Period)
	fmt.Printf("**Dimensions:** %s  \n", strings.Join(report.Metadata.Dimensions, ", "))
	fmt.Printf("**Generated:** %s  \n", report.Metadata.QueryDate.Format("2006-01-02 15:04:05"))
	fmt.Println()

	if report.TotalRows == 0 {
		fmt.Println("*No data found for this query*")
		return
	}

	fmt.Println("## Summary")
	fmt.Println()
	fmt.Printf("- **Total Rows:** %d\n", report.TotalRows)
	fmt.Printf("- **Total Clicks:** %d\n", report.Aggregates.TotalClicks)
	fmt.Printf("- **Total Impressions:** %d\n", report.Aggregates.TotalImpressions)
	fmt.Printf("- **Average CTR:** %.2f%%\n", report.Aggregates.AverageCTR*100)
	fmt.Printf("- **Average Position:** %.1f\n", report.Aggregates.AveragePosition)
	fmt.Println()

	fmt.Println("## Results")
	fmt.Println()

	// Limit to top 50 rows for markdown readability.
	rows := report.Rows
	if len(rows) > 50 {
		rows = rows[:50]
	}
	_ = render.Render(os.Stdout, render.FormatMarkdown, analyticsColumns(report), rows, analyticsMarkdownRow)

	if report.TotalRows > 50 {
		fmt.Println()
		fmt.Printf("*Showing top 50 of %d total rows*\n", report.TotalRows)
	}
}

func displayAnalyticsSummary(report *gsc.SearchAnalyticsReport) {
	fmt.Println()
	color.Cyan("═══ Report Summary ═══")
	fmt.Printf("Period:         %s\n", report.Period)
	fmt.Printf("Total Rows:     %d\n", report.TotalRows)
	fmt.Printf("Total Clicks:   %s\n", color.GreenString("%d", report.Aggregates.TotalClicks))
	fmt.Printf("Total Impressions: %s\n", color.BlueString("%d", report.Aggregates.TotalImpressions))
	fmt.Printf("Average CTR:    %s\n", color.YellowString("%.2f%%", report.Aggregates.AverageCTR*100))
	fmt.Printf("Avg Position:   %s\n", formatPosition(report.Aggregates.AveragePosition))
	fmt.Println()
}

func displayAnalyticsQuotaStatus(client *gsc.Client) {
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

func formatPosition(pos float64) string {
	// Color-code position (1-3 = green, 4-10 = yellow, 10+ = red)
	if pos <= 3.0 {
		return color.GreenString("%.1f", pos)
	} else if pos <= 10.0 {
		return color.YellowString("%.1f", pos)
	}
	return color.RedString("%.1f", pos)
}
