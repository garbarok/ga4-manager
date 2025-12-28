package cmd

import (
	"fmt"
	"os"
	"time"

	"github.com/fatih/color"
	"github.com/olekukonko/tablewriter"
	"github.com/spf13/cobra"

	"github.com/garbarok/ga4-manager/internal/gsc"
)

var (
	gscInspectURL      string
	gscRichResultsOnly bool
)

var gscInspectCmd = &cobra.Command{
	Use:   "inspect",
	Short: "Inspect URL indexing status in Google Search Console",
	Long: `Check if URLs are indexed by Google and view coverage issues.

The URL Inspection API provides detailed information about:
  - Index status (indexed, excluded, error)
  - Coverage state (submitted and indexed, not found, blocked, etc.)
  - Mobile usability issues
  - Rich results validation
  - Robots.txt blocking
  - Last crawl time

Property Types:
  - Domain property: sc-domain:example.com (RECOMMENDED - covers all subdomains and protocols)
  - URL prefix: https://example.com/ (less flexible, exact URL match, must end with /)

Note: Domain properties are more reliable and flexible. Use them unless you specifically
need URL prefix properties.

Rate Limits:
  - 2,000 URL inspections per day
  - 600 inspections per minute per property

Examples:
  # Inspect a single URL (domain property - RECOMMENDED)
  ga4 gsc inspect url --site sc-domain:example.com --url https://example.com/page

  # Inspect homepage
  ga4 gsc inspect url --site sc-domain:example.com --url https://example.com/

  # Inspect a blog post
  ga4 gsc inspect url --site sc-domain:example.com --url https://example.com/blog/post

  # Using URL prefix property (alternative, less flexible)
  ga4 gsc inspect url --site https://example.com/ --url https://example.com/page`,
}

var gscInspectURLCmd = &cobra.Command{
	Use:   "url",
	Short: "Inspect a single URL",
	Long:  "Check the indexing status of a specific URL and view any coverage or mobile usability issues.",
	RunE:  runGSCInspectURL,
}

func init() {
	gscCmd.AddCommand(gscInspectCmd)
	gscInspectCmd.AddCommand(gscInspectURLCmd)

	// Site URL flag (required, inherited from parent)
	gscInspectCmd.PersistentFlags().StringVarP(&gscSiteURL, "site", "s", "", "Site URL: domain property (sc-domain:example.com) or URL prefix (https://example.com/)")
	_ = gscInspectCmd.MarkPersistentFlagRequired("site")

	// URL flag (required for url command)
	gscInspectURLCmd.Flags().StringVarP(&gscInspectURL, "url", "u", "", "URL to inspect (e.g., https://example.com/page)")
	_ = gscInspectURLCmd.MarkFlagRequired("url")

	// Rich results only flag (optional)
	gscInspectURLCmd.Flags().BoolVarP(&gscRichResultsOnly, "rich-results-only", "r", false, "Show only rich results information")
}

func runGSCInspectURL(cmd *cobra.Command, args []string) error {
	// Create GSC client
	client, err := gsc.NewClient()
	if err != nil {
		color.Red("✗ Failed to create GSC client: %v", err)
		return err
	}
	defer func() { _ = client.Close() }()

	// Display progress
	color.Cyan("🔍 Inspecting URL: %s", gscInspectURL)
	fmt.Println()

	// Call API
	result, err := client.InspectURL(gscSiteURL, gscInspectURL)
	if err != nil {
		color.Red("✗ Failed to inspect URL: %v", err)
		return err
	}

	// Display detailed results
	displayInspectionResult(result, gscRichResultsOnly)

	// Display quota status (skip if rich-results-only mode)
	if !gscRichResultsOnly {
		displayInspectQuotaStatus(client)
	}

	return nil
}

func displayInspectionResult(result *gsc.URLInspectionResult, richResultsOnly bool) {
	// Header
	if richResultsOnly {
		color.Cyan("═══ Rich Results Validation ═══")
	} else {
		color.Cyan("═══ URL Inspection Results ═══")
	}
	fmt.Println()

	// URL
	fmt.Printf("URL: %s\n", result.URL)
	fmt.Println()

	// If rich-results-only mode, skip to rich results section
	if richResultsOnly {
		displayRichResults(result)
		return
	}

	// Index Status
	color.Cyan("Index Status:")
	status := result.IndexStatus
	switch status {
	case "PASS":
		color.Green("  ✓ Indexed (%s)", status)
	case "PARTIAL":
		color.Yellow("  ⚠ Partially Indexed (%s)", status)
	case "FAIL":
		color.Red("  ✗ Not Indexed (%s)", status)
	default:
		fmt.Printf("  Status: %s\n", status)
	}

	// Coverage State
	if result.CoverageState != "" {
		fmt.Printf("  Coverage: %s\n", result.CoverageState)
	}
	fmt.Println()

	// Crawl Information
	if result.LastCrawlTime != "" {
		color.Cyan("Crawl Information:")
		// Parse and format time
		if t, err := time.Parse(time.RFC3339, result.LastCrawlTime); err == nil {
			fmt.Printf("  Last Crawl: %s\n", t.Format("2006-01-02 15:04:05 MST"))
		} else {
			fmt.Printf("  Last Crawl: %s\n", result.LastCrawlTime)
		}
		fmt.Println()
	}

	// Canonical URLs
	if result.GoogleCanonical != "" || result.UserCanonical != "" {
		color.Cyan("Canonical URLs:")
		if result.GoogleCanonical != "" {
			fmt.Printf("  Google Canonical: %s\n", result.GoogleCanonical)
		}
		if result.UserCanonical != "" {
			fmt.Printf("  User Canonical: %s\n", result.UserCanonical)
		}
		fmt.Println()
	}

	// Indexing Allowed
	color.Cyan("Indexing Status:")
	if result.IndexingAllowed {
		color.Green("  ✓ Indexing Allowed")
	} else {
		color.Red("  ✗ Indexing Not Allowed")
	}

	if result.RobotsBlocked {
		color.Red("  ✗ Blocked by robots.txt")
	}
	fmt.Println()

	// Mobile Usability
	color.Cyan("Mobile Usability:")
	if result.MobileUsable {
		color.Green("  ✓ Mobile Usable")
	} else {
		color.Red("  ✗ Not Mobile Usable")
	}

	if len(result.MobileIssues) > 0 {
		color.Yellow("  Mobile Issues:")
		for _, issue := range result.MobileIssues {
			fmt.Printf("    - %s\n", issue)
		}
	}
	fmt.Println()

	// Rich Results
	displayRichResults(result)

	// Indexing Issues Summary
	if len(result.IndexingIssues) > 0 {
		color.Cyan("Issues Found:")
		table := tablewriter.NewWriter(os.Stdout)
		table.SetHeader([]string{"Severity", "Issue Type", "Message"})
		table.SetBorder(true)
		table.SetAutoWrapText(false)

		for _, issue := range result.IndexingIssues {
			var severity string
			switch issue.Severity {
			case "ERROR":
				severity = color.RedString("ERROR")
			case "WARNING":
				severity = color.YellowString("WARNING")
			default:
				severity = issue.Severity
			}

			table.Append([]string{
				severity,
				issue.IssueType,
				issue.Message,
			})
		}

		table.Render()
		fmt.Println()
	} else {
		color.Green("✓ No issues detected")
		fmt.Println()
	}
}

// displayRichResults shows rich results information including types and detected items
func displayRichResults(result *gsc.URLInspectionResult) {
	if result.RichResultsStatus == "" {
		color.Yellow("ℹ No rich results data available")
		fmt.Println()
		return
	}

	color.Cyan("Rich Results:")

	// Display verdict
	switch result.RichResultsStatus {
	case "PASS":
		color.Green("  ✓ Valid (%s)", result.RichResultsStatus)
	case "FAIL":
		color.Red("  ✗ Invalid (%s)", result.RichResultsStatus)
	default:
		fmt.Printf("  Status: %s\n", result.RichResultsStatus)
	}

	// Display detected types
	if len(result.RichResultTypes) > 0 {
		fmt.Printf("  Detected Types: %s\n", formatRichResultTypes(result.RichResultTypes))
	}

	// Display detected items with details
	if len(result.RichResultItems) > 0 {
		color.Cyan("\n  Detected Items:")
		for i, item := range result.RichResultItems {
			fmt.Printf("    %d. %s", i+1, item.Type)
			if item.Name != "" {
				fmt.Printf(" - %s", item.Name)
			}
			fmt.Println()

			// Show item-specific issues
			if len(item.Issues) > 0 {
				color.Yellow("       Issues:")
				for _, issue := range item.Issues {
					fmt.Printf("         - %s\n", issue)
				}
			}
		}
	}

	// Display legacy flat issues list (for backward compatibility)
	if len(result.RichResultsIssues) > 0 && len(result.RichResultItems) == 0 {
		color.Yellow("  Rich Results Issues:")
		for _, issue := range result.RichResultsIssues {
			fmt.Printf("    - %s\n", issue)
		}
	}

	fmt.Println()
}

// formatRichResultTypes formats the types array for display
func formatRichResultTypes(types []string) string {
	if len(types) == 0 {
		return "None"
	}
	if len(types) == 1 {
		return types[0]
	}
	// Join with commas
	result := types[0]
	for i := 1; i < len(types); i++ {
		result += ", " + types[i]
	}
	return result
}

func displayInspectQuotaStatus(client *gsc.Client) {
	used, limit, date := client.GetQuotaStatus()
	percentage := float64(used) / float64(limit) * 100

	color.Cyan("═══ Daily Quota Status ═══")
	fmt.Println()

	fmt.Printf("Date: %s\n", date)
	fmt.Printf("Inspections: %d / %d (%.1f%% used, %d remaining)\n",
		used, limit, percentage, limit-used)

	// Show warning if approaching limits
	if percentage >= 95 {
		color.Red("⚠ CRITICAL: Approaching daily limit!")
	} else if percentage >= 75 {
		color.Yellow("⚠ WARNING: %.0f%% of daily quota used", percentage)
	}
	fmt.Println()
}
