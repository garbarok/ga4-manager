package cmd

import (
	"fmt"
	"os"
	"strings"

	"github.com/fatih/color"
	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/garbarok/ga4-manager/internal/ga4"
	"github.com/garbarok/ga4-manager/internal/tui"
	"github.com/spf13/cobra"
)

var (
	linkService    string
	linkURL        string
	linkGCPProject string
	linkDataset    string
	listLinks      bool
	unlinkService  string
)

var linkCmd = &cobra.Command{
	Use:   "link",
	Short: "Link and unlink external services to GA4 properties",
	Long: `Link and unlink services like Search Console, BigQuery, and Channel Groups.

Supported services for linking:
  - search-console: Provides a setup guide for linking Google Search Console.
  - bigquery: Creates a BigQuery export link.
  - channels: Sets up default channel groupings.

Supported services for unlinking:
  - bigquery: Deletes a BigQuery export link.
  - channels: Deletes a custom channel group.`,
	RunE: runLink,
}

func init() {
	rootCmd.AddCommand(linkCmd)
	linkCmd.Flags().StringVarP(&projectName, "project", "p", "", "Config file name (e.g., basic-ecommerce, content-site)")
	linkCmd.Flags().StringVarP(&linkService, "service", "s", "", "Service to link (search-console, bigquery, channels)")
	linkCmd.Flags().StringVarP(&linkURL, "url", "u", "", "Site URL for Search Console")
	linkCmd.Flags().StringVar(&linkGCPProject, "gcp-project", "", "GCP Project ID for BigQuery")
	linkCmd.Flags().StringVar(&linkDataset, "dataset", "", "BigQuery dataset ID")
	linkCmd.Flags().BoolVarP(&listLinks, "list", "l", false, "List existing links")
	linkCmd.Flags().StringVar(&unlinkService, "unlink", "", "Service to unlink (e.g., bigquery, channels)")
	_ = linkCmd.MarkFlagRequired("project")
}

func runLink(cmd *cobra.Command, args []string) error {
	fmt.Println("🔗 GA4 Manager - Link External Services")
	fmt.Println("═══════════════════════════════════════════════")

	client, err := newGA4Client()
	if err != nil {
		return err
	}
	defer client.Close()

	// Load project from config file
	cfg, err := config.LoadConfigByName(projectName)
	if err != nil {
		return fmt.Errorf("failed to load config: %w (use --project to specify a config file name)", err)
	}

	fmt.Printf("📦 Project: %s (Property: %s)\n", cfg.Project.Name, cfg.GetPropertyID())
	fmt.Println("───────────────────────────────────────────────")

	if listLinks {
		return listExistingLinks(client, cfg)
	}

	if unlinkService != "" {
		return unlinkExternalService(client, cfg, unlinkService)
	}

	if linkService == "" {
		return fmt.Errorf("you must specify a service to link (--service) or use --list")
	}

	switch linkService {
	case "search-console", "gsc":
		return linkSearchConsole(client, cfg)
	case "bigquery", "bq":
		return linkBigQuery(client, cfg)
	case "channels":
		return setupChannelGroups(client, cfg)
	default:
		return fmt.Errorf("unknown service: %s", linkService)
	}
}

// handleLinkAction handles the "Manage Links" menu action in interactive mode.
func handleLinkAction() {
	projectPath, err := tui.RunProjectSelector()
	if err != nil {
		if err == tui.ErrBackToMenu || err.Error() == "no project selected" {
			return
		}
		fmt.Fprintf(os.Stderr, "Error selecting project: %v\n", err)
		return
	}

	// Validate single project selection
	if projectPath == "--all" {
		fmt.Println("\n⚠️  Link management requires a specific project.")
		fmt.Println("Please select a single project instead of 'All Projects'.")
		return
	}

	// Load project configuration
	cfg, err := config.LoadConfig(projectPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error loading config: %v\n", err)
		return
	}

	// Create GA4 client
	client, err := newGA4Client()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return
	}
	defer client.Close()

	// Show link management submenu
	showLinkManagementMenu(client, cfg)
}

// showLinkManagementMenu displays and handles the link management submenu.
func showLinkManagementMenu(client *ga4.Client, cfg *config.ProjectConfig) {
	fmt.Printf("\n🔗 Link Management - %s (Property: %s)\n", cfg.Project.Name, cfg.GetPropertyID())
	fmt.Println(strings.Repeat("━", 50))

	fmt.Println("\n📋 What would you like to do?")
	fmt.Println("  1. View existing links and connections")
	fmt.Println("  2. Setup channel groups")
	fmt.Println("  3. Get Search Console setup guide")
	fmt.Println("  4. Get BigQuery setup guide")
	fmt.Println("  5. Delete channel groups")
	fmt.Println("  6. Back to main menu")
	fmt.Print("\nSelect option (1-6): ")

	var choice string
	_, _ = fmt.Scanln(&choice)

	routeLinkOperation(client, cfg, choice)
}

// routeLinkOperation routes to the selected link operation.
func routeLinkOperation(client *ga4.Client, cfg *config.ProjectConfig, choice string) {
	switch choice {
	case "1":
		handleViewLinks(client, cfg)
	case "2":
		handleSetupChannels(client, cfg)
	case "3":
		handleSearchConsoleGuide(client, cfg)
	case "4":
		handleBigQueryGuide(client, cfg)
	case "5":
		handleDeleteChannels(client, cfg)
	case "6", "":
		return
	default:
		fmt.Println("\n⚠️  Invalid choice.")
	}
}

// handleViewLinks displays existing links and connections.
func handleViewLinks(client *ga4.Client, cfg *config.ProjectConfig) {
	fmt.Println()
	fmt.Println("🔍 Checking existing links...")
	fmt.Println()
	if err := listExistingLinks(client, cfg); err != nil {
		fmt.Fprintf(os.Stderr, "Error listing links: %v\n", err)
	}
}

// handleSetupChannels sets up default channel groups.
func handleSetupChannels(client *ga4.Client, cfg *config.ProjectConfig) {
	fmt.Println("\n📡 Setting up default channel groups...")
	fmt.Println("\nThis will create the following channel groups:")

	defaultGroups := ga4.DefaultChannelGroups()
	for i, group := range defaultGroups {
		fmt.Printf("  %d. %s - %s\n", i+1, group.DisplayName, group.Description)
	}

	if !confirmAction("\nProceed with setup? (y/n): ") {
		fmt.Println("\n❌ Setup cancelled.")
		return
	}

	if err := client.SetupDefaultChannelGroups(cfg.GetPropertyID()); err != nil {
		fmt.Fprintf(os.Stderr, "\n❌ Error setting up channel groups: %v\n", err)
	} else {
		fmt.Println("\n✅ Channel groups setup completed!")
	}
}

// handleSearchConsoleGuide generates Search Console setup guide.
func handleSearchConsoleGuide(client *ga4.Client, cfg *config.ProjectConfig) {
	fmt.Print("\n🔗 Enter your website URL (e.g., https://example.com): ")
	var siteURL string
	_, _ = fmt.Scanln(&siteURL)

	if siteURL == "" {
		fmt.Println("\n⚠️  No URL provided.")
		return
	}

	fmt.Println()
	guide := client.GenerateSearchConsoleSetupGuide(cfg.GetPropertyID(), siteURL)
	fmt.Println(guide)
	fmt.Printf("\nℹ️  The GA4 Admin API does not support programmatic Search Console linking.\n")
	fmt.Println("Please follow the manual steps above.")
}

// handleBigQueryGuide generates BigQuery setup guide.
func handleBigQueryGuide(client *ga4.Client, cfg *config.ProjectConfig) {
	fmt.Print("\n📊 Enter GCP Project ID: ")
	var gcpProject string
	_, _ = fmt.Scanln(&gcpProject)

	if gcpProject == "" {
		fmt.Println("\n⚠️  No GCP Project ID provided.")
		return
	}

	propertyID := cfg.GetPropertyID()
	fmt.Printf("Enter BigQuery Dataset ID (default: analytics_%s): ", propertyID)
	var dataset string
	_, _ = fmt.Scanln(&dataset)

	if dataset == "" {
		dataset = fmt.Sprintf("analytics_%s", propertyID)
	}

	bqConfig := ga4.GetDefaultBigQueryConfig(propertyID, gcpProject, dataset)
	guide := client.GenerateBigQuerySetupGuide(bqConfig)
	fmt.Println(guide)
	fmt.Printf("\nℹ️  BigQuery links must be created manually in the GA4 UI.\n")
}

// handleDeleteChannels manages channel group deletion.
func handleDeleteChannels(client *ga4.Client, cfg *config.ProjectConfig) {
	fmt.Println("\n🗑️  Listing custom channel groups...")

	groups, err := client.ListCustomChannelGroups(cfg.GetPropertyID())
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error listing channel groups: %v\n", err)
		return
	}

	if len(groups) == 0 {
		fmt.Println("\n✓ No custom channel groups found to delete.")
		return
	}

	customGroups := make([]channelGroupInfo, len(groups))
	for i, g := range groups {
		customGroups[i] = channelGroupInfo{Name: g.Name, DisplayName: g.DisplayName}
	}

	displayCustomChannelGroups(customGroups)
	executeChannelGroupDeletion(client, customGroups)
}

// channelGroupInfo holds channel group information for interactive display.
type channelGroupInfo struct {
	Name        string
	DisplayName string
}

// displayCustomChannelGroups displays the list of custom channel groups.
func displayCustomChannelGroups(groups []channelGroupInfo) {
	fmt.Println("\nCustom Channel Groups:")
	for i, g := range groups {
		fmt.Printf("  %d. %s\n", i+1, g.DisplayName)
	}
}

// executeChannelGroupDeletion executes the channel group deletion.
func executeChannelGroupDeletion(client *ga4.Client, groups []channelGroupInfo) {
	fmt.Print("\nEnter number to delete (or 'all' to delete all, 'cancel' to abort): ")
	var choice string
	_, _ = fmt.Scanln(&choice)

	if choice == "cancel" || choice == "" {
		fmt.Println("\n❌ Delete cancelled.")
		return
	}

	if choice == "all" {
		deleteAllChannelGroups(client, groups)
		return
	}

	deleteSingleChannelGroup(client, groups, choice)
}

// deleteAllChannelGroups deletes all custom channel groups.
func deleteAllChannelGroups(client *ga4.Client, groups []channelGroupInfo) {
	if !confirmDangerous(fmt.Sprintf("\n⚠️  Are you sure you want to delete ALL %d custom channel groups? (yes/no): ", len(groups))) {
		fmt.Println("\n❌ Delete cancelled.")
		return
	}

	for _, g := range groups {
		fmt.Printf("Deleting '%s'...\n", g.DisplayName)
		if err := client.DeleteChannelGroup(g.Name); err != nil {
			fmt.Fprintf(os.Stderr, "  ❌ Error: %v\n", err)
		} else {
			fmt.Println("  ✓ Deleted")
		}
	}
	fmt.Println("\n✅ Batch delete completed.")
}

// deleteSingleChannelGroup deletes a single channel group.
func deleteSingleChannelGroup(client *ga4.Client, groups []channelGroupInfo, choice string) {
	var idx int
	if _, err := fmt.Sscanf(choice, "%d", &idx); err != nil || idx < 1 || idx > len(groups) {
		fmt.Println("\n⚠️  Invalid choice.")
		return
	}

	selected := groups[idx-1]
	fmt.Printf("\nDeleting '%s'...\n", selected.DisplayName)
	if err := client.DeleteChannelGroup(selected.Name); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
	} else {
		fmt.Println("✅ Successfully deleted!")
	}
}

// confirmAction prompts for yes/no confirmation.
func confirmAction(prompt string) bool {
	fmt.Print(prompt)
	var confirm string
	_, _ = fmt.Scanln(&confirm)
	return confirm == "y" || confirm == "Y" || confirm == "yes"
}

// confirmDangerous prompts for explicit "yes" confirmation for dangerous operations.
func confirmDangerous(prompt string) bool {
	fmt.Print(prompt)
	var confirm string
	_, _ = fmt.Scanln(&confirm)
	return confirm == "yes"
}

func listExistingLinks(client *ga4.Client, cfg *config.ProjectConfig) error {
	green := color.New(color.FgGreen).SprintFunc()
	yellow := color.New(color.FgYellow).SprintFunc()
	cyan := color.New(color.FgCyan).SprintFunc()

	fmt.Printf("\n%s Existing Links and Configurations\n", cyan("🔍"))

	// Search Console
	fmt.Println("\nSearch Console:")
	fmt.Printf("  %s Manual check required. The Admin API cannot list Search Console links.\n", yellow("○"))

	// BigQuery
	fmt.Println("\nBigQuery Export:")
	bqLinks, err := client.ListBigQueryLinks(cfg.GetPropertyID())
	if err != nil {
		fmt.Printf("  %s Error: %v\n", color.New(color.FgRed).Sprint("✗"), err)
	} else if len(bqLinks) == 0 {
		fmt.Printf("  %s No BigQuery export configured.\n", yellow("○"))
	} else {
		for _, link := range bqLinks {
			fmt.Printf("  %s Project: %s\n", green("✓"), link.Project)
			fmt.Printf("    Daily: %v, Streaming: %v\n", link.DailyExportEnabled, link.StreamingExportEnabled)
		}
	}

	// Channel Groups
	fmt.Println("\nChannel Groups:")
	channelGroups, err := client.ListChannelGroups(cfg.GetPropertyID())
	if err != nil {
		fmt.Printf("  %s Error: %v\n", color.New(color.FgRed).Sprint("✗"), err)
	} else if len(channelGroups) == 0 {
		fmt.Printf("  %s No custom channel groups found.\n", yellow("○"))
	} else {
		for _, group := range channelGroups {
			fmt.Printf("  %s %s\n", green("✓"), group.DisplayName)
		}
	}
	fmt.Println()
	return nil
}

func linkSearchConsole(client *ga4.Client, cfg *config.ProjectConfig) error {
	if linkURL == "" {
		return fmt.Errorf("the --url flag is required for the Search Console service")
	}

	fmt.Printf("\n%s Search Console Link Setup Guide\n", color.New(color.FgCyan).SprintFunc()("🔗"))
	guide := client.GenerateSearchConsoleSetupGuide(cfg.GetPropertyID(), linkURL)
	fmt.Println(guide)
	fmt.Printf("%s The GA4 Admin API does not support programmatic Search Console linking. Please follow the manual steps above.\n", color.New(color.FgYellow).SprintFunc()("ℹ"))
	return nil
}

func linkBigQuery(client *ga4.Client, cfg *config.ProjectConfig) error {
	if linkGCPProject == "" || linkDataset == "" {
		return fmt.Errorf("both --gcp-project and --dataset flags are required for BigQuery linking")
	}

	fmt.Printf("\n%s Linking BigQuery...\n", color.New(color.FgCyan).SprintFunc()("📊"))

	propertyID := cfg.GetPropertyID()
	exists, err := client.BigQueryLinkExists(propertyID)
	if err != nil {
		return fmt.Errorf("could not check for existing BigQuery links: %w", err)
	}
	if exists {
		_, _ = color.New(color.FgYellow).Println("✓ A BigQuery link already exists for this property. No action taken.")
		return nil
	}

	bqCfg := ga4.GetDefaultBigQueryConfig(propertyID, linkGCPProject, linkDataset)
	createdLink, err := client.CreateBigQueryLink(bqCfg)
	if err != nil {
		return fmt.Errorf("could not create BigQuery link: %w", err)
	}

	_, _ = color.New(color.FgGreen).Printf("✓ Successfully created BigQuery link: %s\n", createdLink.Name)
	return nil
}

func setupChannelGroups(client *ga4.Client, cfg *config.ProjectConfig) error {
	fmt.Printf("\n%s Setting up default Channel Groups...\n", color.New(color.FgCyan).SprintFunc()("📡"))

	if err := client.SetupDefaultChannelGroups(cfg.GetPropertyID()); err != nil {
		_, _ = color.New(color.FgRed).Printf("✗ An error occurred during channel group setup: %v\n", err)
		return err
	}

	_, _ = color.New(color.FgGreen).Println("✓ Channel group setup process completed.")
	fmt.Println("Please check the output above for the status of each channel group.")
	return nil
}

func unlinkExternalService(client *ga4.Client, cfg *config.ProjectConfig, service string) error {
	fmt.Printf("\n%s Unlinking service: %s\n", color.New(color.FgYellow).SprintFunc()("🔓"), service)

	deleted, err := client.UnlinkService(cfg.GetPropertyID(), service)
	if err != nil {
		return err
	}

	if len(deleted) == 0 {
		_, _ = color.New(color.FgYellow).Println("No links found to unlink.")
		return nil
	}

	for _, name := range deleted {
		_, _ = color.New(color.FgGreen).Printf("✓ Successfully deleted %s\n", name)
	}
	return nil
}
