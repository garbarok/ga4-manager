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
	gscSiteURL    string
	gscSitemapURL string
)

var gscSitemapsCmd = &cobra.Command{
	Use:   "sitemaps",
	Short: "Manage sitemaps in Google Search Console",
	Long: `List, submit, and delete sitemaps in Google Search Console.

Property Types:
  - Domain property: sc-domain:example.com (covers all subdomains and protocols)
  - URL prefix: https://example.com/ (exact URL match, must end with /)

Examples:
  # List all sitemaps (domain property)
  ga4 gsc sitemaps list --site sc-domain:example.com

  # List all sitemaps (URL prefix)
  ga4 gsc sitemaps list --site https://example.com/

  # Submit a sitemap
  ga4 gsc sitemaps submit --site sc-domain:example.com --url https://example.com/sitemap.xml

  # Delete a sitemap
  ga4 gsc sitemaps delete --site sc-domain:example.com --url https://example.com/old-sitemap.xml

  # Get details about a specific sitemap
  ga4 gsc sitemaps get --site sc-domain:example.com --url https://example.com/sitemap.xml`,
}

var gscSitemapsListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all sitemaps for a site",
	Long:  "Retrieve all sitemaps submitted to Google Search Console for a verified site.",
	RunE:  runGSCSitemapsList,
}

var gscSitemapsSubmitCmd = &cobra.Command{
	Use:   "submit",
	Short: "Submit a sitemap to Google Search Console",
	Long:  "Submit a sitemap URL to Google Search Console for crawling and indexing.",
	RunE:  runGSCSitemapsSubmit,
}

var gscSitemapsDeleteCmd = &cobra.Command{
	Use:   "delete",
	Short: "Delete a sitemap from Google Search Console",
	Long:  "Remove a sitemap from Google Search Console. This does not delete the sitemap file itself.",
	RunE:  runGSCSitemapsDelete,
}

var gscSitemapsGetCmd = &cobra.Command{
	Use:   "get",
	Short: "Get details about a specific sitemap",
	Long:  "Retrieve detailed information about a specific sitemap including status, errors, and content counts.",
	RunE:  runGSCSitemapsGet,
}

func init() {
	gscCmd.AddCommand(gscSitemapsCmd)
	gscSitemapsCmd.AddCommand(gscSitemapsListCmd)
	gscSitemapsCmd.AddCommand(gscSitemapsSubmitCmd)
	gscSitemapsCmd.AddCommand(gscSitemapsDeleteCmd)
	gscSitemapsCmd.AddCommand(gscSitemapsGetCmd)

	// Site URL flag (required for all commands)
	gscSitemapsCmd.PersistentFlags().StringVarP(&gscSiteURL, "site", "s", "", "Site URL: domain property (sc-domain:example.com) or URL prefix (https://example.com/)")
	_ = gscSitemapsCmd.MarkPersistentFlagRequired("site")

	// Sitemap URL flag (required for submit, delete, get)
	gscSitemapsSubmitCmd.Flags().StringVarP(&gscSitemapURL, "url", "u", "", "Sitemap URL (e.g., https://example.com/sitemap.xml)")
	_ = gscSitemapsSubmitCmd.MarkFlagRequired("url")

	gscSitemapsDeleteCmd.Flags().StringVarP(&gscSitemapURL, "url", "u", "", "Sitemap URL to delete")
	_ = gscSitemapsDeleteCmd.MarkFlagRequired("url")

	gscSitemapsGetCmd.Flags().StringVarP(&gscSitemapURL, "url", "u", "", "Sitemap URL to retrieve")
	_ = gscSitemapsGetCmd.MarkFlagRequired("url")
}

func runGSCSitemapsList(cmd *cobra.Command, args []string) error {
	// Create GSC client
	client, err := gsc.NewClient()
	if err != nil {
		color.Red("✗ Failed to create GSC client: %v", err)
		return err
	}
	defer func() { _ = client.Close() }()

	// List sitemaps
	color.Cyan("📍 Listing sitemaps for %s", gscSiteURL)
	sitemaps, err := client.ListSitemaps(gscSiteURL)
	if err != nil {
		color.Red("✗ Failed to list sitemaps: %v", err)
		return err
	}

	if len(sitemaps) == 0 {
		color.Yellow("No sitemaps found for this site")
		return nil
	}

	// Display sitemaps in a table
	table := tablewriter.NewWriter(os.Stdout)
	table.SetHeader([]string{"Sitemap URL", "URLs", "Errors", "Warnings", "Last Submitted", "Status"})
	table.SetBorder(true)
	table.SetRowLine(true)
	table.SetAutoWrapText(false)

	for _, sm := range sitemaps {
		var status string
		if sm.Errors > 0 {
			status = color.RedString("Errors: %d", sm.Errors)
		} else if sm.Warnings > 0 {
			status = color.YellowString("Warnings: %d", sm.Warnings)
		} else if sm.IsPending {
			status = color.YellowString("Pending")
		} else {
			status = color.GreenString("OK")
		}

		lastSubmitted := "Never"
		if sm.LastSubmitted != "" {
			t, err := time.Parse(time.RFC3339, sm.LastSubmitted)
			if err == nil {
				lastSubmitted = t.Format("2006-01-02 15:04")
			} else {
				lastSubmitted = sm.LastSubmitted
			}
		}

		sitemapType := sm.Path
		if sm.IsSitemapsIndex {
			sitemapType += " (Index)"
		}

		table.Append([]string{
			sitemapType,
			fmt.Sprintf("%d", sm.ContentsCount),
			fmt.Sprintf("%d", sm.Errors),
			fmt.Sprintf("%d", sm.Warnings),
			lastSubmitted,
			status,
		})
	}

	table.Render()
	color.Green("\n✓ Found %d sitemap(s)", len(sitemaps))
	return nil
}

func runGSCSitemapsSubmit(cmd *cobra.Command, args []string) error {
	// Create GSC client
	client, err := gsc.NewClient()
	if err != nil {
		color.Red("✗ Failed to create GSC client: %v", err)
		return err
	}
	defer func() { _ = client.Close() }()

	// Submit sitemap
	color.Cyan("📤 Submitting sitemap to Google Search Console...")
	color.Cyan("   Site: %s", gscSiteURL)
	color.Cyan("   Sitemap: %s", gscSitemapURL)

	if err := client.SubmitSitemap(gscSiteURL, gscSitemapURL); err != nil {
		color.Red("✗ Failed to submit sitemap: %v", err)
		return err
	}

	color.Green("✓ Sitemap submitted successfully")
	color.Cyan("\nNote: It may take a few hours for Google to process the sitemap.")
	color.Cyan("Use 'ga4 gsc sitemaps get' to check the status later.")
	return nil
}

func runGSCSitemapsDelete(cmd *cobra.Command, args []string) error {
	// Create GSC client
	client, err := gsc.NewClient()
	if err != nil {
		color.Red("✗ Failed to create GSC client: %v", err)
		return err
	}
	defer func() { _ = client.Close() }()

	// Delete sitemap
	color.Cyan("🗑️  Deleting sitemap from Google Search Console...")
	color.Cyan("   Site: %s", gscSiteURL)
	color.Cyan("   Sitemap: %s", gscSitemapURL)

	if err := client.DeleteSitemap(gscSiteURL, gscSitemapURL); err != nil {
		color.Red("✗ Failed to delete sitemap: %v", err)
		return err
	}

	color.Green("✓ Sitemap deleted successfully")
	color.Cyan("\nNote: This only removes the sitemap from Search Console.")
	color.Cyan("The sitemap file itself is still hosted on your server.")
	return nil
}

func runGSCSitemapsGet(cmd *cobra.Command, args []string) error {
	// Create GSC client
	client, err := gsc.NewClient()
	if err != nil {
		color.Red("✗ Failed to create GSC client: %v", err)
		return err
	}
	defer func() { _ = client.Close() }()

	// Get sitemap
	color.Cyan("📍 Retrieving sitemap details...")
	sm, err := client.GetSitemap(gscSiteURL, gscSitemapURL)
	if err != nil {
		color.Red("✗ Failed to get sitemap: %v", err)
		return err
	}

	// Display sitemap details
	fmt.Println()
	color.Cyan("═══ Sitemap Details ═══")
	fmt.Printf("URL: %s\n", sm.Path)

	if sm.IsSitemapsIndex {
		color.Cyan("Type: Sitemap Index")
	} else {
		color.Cyan("Type: Regular Sitemap")
	}

	if sm.LastSubmitted != "" {
		t, err := time.Parse(time.RFC3339, sm.LastSubmitted)
		if err == nil {
			fmt.Printf("Last Submitted: %s\n", t.Format("2006-01-02 15:04:05"))
		} else {
			fmt.Printf("Last Submitted: %s\n", sm.LastSubmitted)
		}
	}

	if sm.LastDownloaded != "" {
		t, err := time.Parse(time.RFC3339, sm.LastDownloaded)
		if err == nil {
			fmt.Printf("Last Downloaded: %s\n", t.Format("2006-01-02 15:04:05"))
		} else {
			fmt.Printf("Last Downloaded: %s\n", sm.LastDownloaded)
		}
	}

	if sm.IsPending {
		color.Yellow("Status: Pending (Google is processing)")
	} else {
		color.Green("Status: Processed")
	}

	// Display errors and warnings
	if sm.Errors > 0 {
		color.Red("Errors: %d", sm.Errors)
	} else {
		color.Green("Errors: 0")
	}

	if sm.Warnings > 0 {
		color.Yellow("Warnings: %d", sm.Warnings)
	} else {
		color.Green("Warnings: 0")
	}

	// Display contents
	if len(sm.Contents) > 0 {
		fmt.Println()
		color.Cyan("═══ Content Breakdown ═══")
		table := tablewriter.NewWriter(os.Stdout)
		table.SetHeader([]string{"Type", "Submitted", "Indexed"})
		table.SetBorder(true)

		for _, content := range sm.Contents {
			indexedPct := 0.0
			if content.Submitted > 0 {
				indexedPct = (float64(content.Indexed) / float64(content.Submitted)) * 100
			}

			table.Append([]string{
				content.Type,
				fmt.Sprintf("%d", content.Submitted),
				fmt.Sprintf("%d (%.1f%%)", content.Indexed, indexedPct),
			})
		}

		table.Render()
	}

	return nil
}
