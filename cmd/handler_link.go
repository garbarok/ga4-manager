package cmd

import (
	"fmt"
	"os"
	"strings"

	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/garbarok/ga4-manager/internal/ga4"
	"github.com/garbarok/ga4-manager/internal/tui"
	"google.golang.org/api/analyticsadmin/v1alpha"
)

// handleLinkAction handles the "Manage Links" menu action
// Single Responsibility: Manage external service links (Search Console, BigQuery, Channels)
func handleLinkAction() {
	// Run project selector
	projectPath, err := tui.RunProjectSelector()
	if err != nil {
		if err == tui.ErrBackToMenu || err.Error() == "no project selected" {
			return // Go back to main menu
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
	project := cfg.ConvertToLegacyProject()

	// Create GA4 client
	client, err := ga4.NewClient()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error creating client: %v\n", err)
		return
	}

	// Show link management submenu
	showLinkManagementMenu(client, project)
}

// showLinkManagementMenu displays and handles the link management submenu
// Interface Segregation: Separate menu for link-related operations
func showLinkManagementMenu(client *ga4.Client, project config.Project) {
	fmt.Printf("\n🔗 Link Management - %s (Property: %s)\n", project.Name, project.PropertyID)
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

	// Route to specific link operation
	routeLinkOperation(client, project, choice)
}

// routeLinkOperation routes to the selected link operation
// Open/Closed Principle: Easy to add new link operations
func routeLinkOperation(client *ga4.Client, project config.Project, choice string) {
	switch choice {
	case "1":
		handleViewLinks(client, project)
	case "2":
		handleSetupChannels(client, project)
	case "3":
		handleSearchConsoleGuide(client, project)
	case "4":
		handleBigQueryGuide(client, project)
	case "5":
		handleDeleteChannels(client, project)
	case "6", "":
		return
	default:
		fmt.Println("\n⚠️  Invalid choice.")
	}
}

// handleViewLinks displays existing links and connections
func handleViewLinks(client *ga4.Client, project config.Project) {
	fmt.Println()
	fmt.Println("🔍 Checking existing links...")
	fmt.Println()
	if err := listExistingLinks(client, project); err != nil {
		fmt.Fprintf(os.Stderr, "Error listing links: %v\n", err)
	}
}

// handleSetupChannels sets up default channel groups
func handleSetupChannels(client *ga4.Client, project config.Project) {
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

	if err := client.SetupDefaultChannelGroups(project.PropertyID); err != nil {
		fmt.Fprintf(os.Stderr, "\n❌ Error setting up channel groups: %v\n", err)
	} else {
		fmt.Println("\n✅ Channel groups setup completed!")
	}
}

// handleSearchConsoleGuide generates Search Console setup guide
func handleSearchConsoleGuide(client *ga4.Client, project config.Project) {
	fmt.Print("\n🔗 Enter your website URL (e.g., https://example.com): ")
	var siteURL string
	_, _ = fmt.Scanln(&siteURL)

	if siteURL == "" {
		fmt.Println("\n⚠️  No URL provided.")
		return
	}

	fmt.Println()
	guide := client.GenerateSearchConsoleSetupGuide(project.PropertyID, siteURL)
	fmt.Println(guide)
	fmt.Printf("\nℹ️  The GA4 Admin API does not support programmatic Search Console linking.\n")
	fmt.Println("Please follow the manual steps above.")
}

// handleBigQueryGuide generates BigQuery setup guide
func handleBigQueryGuide(client *ga4.Client, project config.Project) {
	fmt.Print("\n📊 Enter GCP Project ID: ")
	var gcpProject string
	_, _ = fmt.Scanln(&gcpProject)

	if gcpProject == "" {
		fmt.Println("\n⚠️  No GCP Project ID provided.")
		return
	}

	fmt.Printf("Enter BigQuery Dataset ID (default: analytics_%s): ", project.PropertyID)
	var dataset string
	_, _ = fmt.Scanln(&dataset)

	if dataset == "" {
		dataset = fmt.Sprintf("analytics_%s", project.PropertyID)
	}

	bqConfig := ga4.GetDefaultBigQueryConfig(project.PropertyID, gcpProject, dataset)
	guide := client.GenerateBigQuerySetupGuide(bqConfig)
	fmt.Println(guide)
	fmt.Printf("\nℹ️  BigQuery links must be created manually in the GA4 UI.\n")
}

// handleDeleteChannels manages channel group deletion
func handleDeleteChannels(client *ga4.Client, project config.Project) {
	fmt.Println("\n🗑️  Listing custom channel groups...")

	groups, err := client.ListChannelGroups(project.PropertyID)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error listing channel groups: %v\n", err)
		return
	}

	// Filter custom groups
	customGroups := filterCustomChannelGroups(groups)

	if len(customGroups) == 0 {
		fmt.Println("\n✓ No custom channel groups found to delete.")
		return
	}

	displayCustomChannelGroups(customGroups)
	executeChannelGroupDeletion(client, customGroups)
}

// channelGroupInfo holds channel group information
type channelGroupInfo struct {
	Name        string
	DisplayName string
}

// filterCustomChannelGroups filters out system-defined channel groups
func filterCustomChannelGroups(groups []*analyticsadmin.GoogleAnalyticsAdminV1alphaChannelGroup) []channelGroupInfo {
	var custom []channelGroupInfo

	for _, g := range groups {
		if !g.SystemDefined {
			custom = append(custom, channelGroupInfo{
				Name:        g.Name,
				DisplayName: g.DisplayName,
			})
		}
	}

	return custom
}

// displayCustomChannelGroups displays the list of custom channel groups
func displayCustomChannelGroups(groups []channelGroupInfo) {
	fmt.Println("\nCustom Channel Groups:")
	for i, g := range groups {
		fmt.Printf("  %d. %s\n", i+1, g.DisplayName)
	}
}

// executeChannelGroupDeletion executes the channel group deletion
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

// deleteAllChannelGroups deletes all custom channel groups
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

// deleteSingleChannelGroup deletes a single channel group
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

// confirmAction prompts for yes/no confirmation
func confirmAction(prompt string) bool {
	fmt.Print(prompt)
	var confirm string
	_, _ = fmt.Scanln(&confirm)
	return confirm == "y" || confirm == "Y" || confirm == "yes"
}

// confirmDangerous prompts for explicit "yes" confirmation for dangerous operations
func confirmDangerous(prompt string) bool {
	fmt.Print(prompt)
	var confirm string
	_, _ = fmt.Scanln(&confirm)
	return confirm == "yes"
}
