package cmd

import (
	"fmt"

	"github.com/fatih/color"
	"github.com/oscargallego/ga4-manager/internal/config"
	"github.com/oscargallego/ga4-manager/internal/ga4"
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
	linkCmd.Flags().StringVarP(&projectName, "project", "p", "", "Project name (e.g., snapcompress, personal)")
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

	client, err := ga4.NewClient()
	if err != nil {
		return fmt.Errorf("failed to create GA4 client: %w", err)
	}

	var project config.Project
	switch projectName {
	case "snapcompress", "snap":
		project = config.SnapCompress
	case "personal":
		project = config.PersonalWebsite
	default:
		return fmt.Errorf("unknown project: %s (use 'snapcompress' or 'personal')", projectName)
	}

	fmt.Printf("📦 Project: %s (Property: %s)\n", project.Name, project.PropertyID)
	fmt.Println("───────────────────────────────────────────────")

	if listLinks {
		return listExistingLinks(client, project)
	}

	if unlinkService != "" {
		return unlinkExternalService(client, project, unlinkService)
	}

	if linkService == "" {
		return fmt.Errorf("you must specify a service to link (--service) or use --list")
	}

	switch linkService {
	case "search-console", "gsc":
		return linkSearchConsole(client, project)
	case "bigquery", "bq":
		return linkBigQuery(client, project)
	case "channels":
		return setupChannelGroups(client, project)
	default:
		return fmt.Errorf("unknown service: %s", linkService)
	}
}

func listExistingLinks(client *ga4.Client, project config.Project) error {
	green := color.New(color.FgGreen).SprintFunc()
	yellow := color.New(color.FgYellow).SprintFunc()
	cyan := color.New(color.FgCyan).SprintFunc()

	fmt.Printf("\n%s Existing Links and Configurations\n", cyan("🔍"))

	// Search Console
	fmt.Println("\nSearch Console:")
	fmt.Printf("  %s Manual check required. The Admin API cannot list Search Console links.\n", yellow("○"))

	// BigQuery
	fmt.Println("\nBigQuery Export:")
	bqLinks, err := client.ListBigQueryLinks(project.PropertyID)
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
	channelGroups, err := client.ListChannelGroups(project.PropertyID)
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

func linkSearchConsole(client *ga4.Client, project config.Project) error {
	if linkURL == "" {
		return fmt.Errorf("the --url flag is required for the Search Console service")
	}

	fmt.Printf("\n%s Search Console Link Setup Guide\n", color.New(color.FgCyan).SprintFunc()("🔗"))
	guide := client.GenerateSearchConsoleSetupGuide(project.PropertyID, linkURL)
	fmt.Println(guide)
	fmt.Printf("%s The GA4 Admin API does not support programmatic Search Console linking. Please follow the manual steps above.\n", color.New(color.FgYellow).SprintFunc()("ℹ"))
	return nil
}

func linkBigQuery(client *ga4.Client, project config.Project) error {
	if linkGCPProject == "" || linkDataset == "" {
		return fmt.Errorf("both --gcp-project and --dataset flags are required for BigQuery linking")
	}

	fmt.Printf("\n%s Linking BigQuery...\n", color.New(color.FgCyan).SprintFunc()("📊"))

	exists, err := client.BigQueryLinkExists(project.PropertyID)
	if err != nil {
		return fmt.Errorf("could not check for existing BigQuery links: %w", err)
	}
	if exists {
		_, _ = color.New(color.FgYellow).Println("✓ A BigQuery link already exists for this property. No action taken.")
		return nil
	}

	config := ga4.GetDefaultBigQueryConfig(project.PropertyID, linkGCPProject, linkDataset)
	createdLink, err := client.CreateBigQueryLink(config)
	if err != nil {
		return fmt.Errorf("could not create BigQuery link: %w", err)
	}

	_, _ = color.New(color.FgGreen).Printf("✓ Successfully created BigQuery link: %s\n", createdLink.Name)
	return nil
}

func setupChannelGroups(client *ga4.Client, project config.Project) error {
	fmt.Printf("\n%s Setting up default Channel Groups...\n", color.New(color.FgCyan).SprintFunc()("📡"))

	if err := client.SetupDefaultChannelGroups(project.PropertyID); err != nil {
		_, _ = color.New(color.FgRed).Printf("✗ An error occurred during channel group setup: %v\n", err)
		return err
	}

	_, _ = color.New(color.FgGreen).Println("✓ Channel group setup process completed.")
	fmt.Println("Please check the output above for the status of each channel group.")
	return nil
}

func unlinkExternalService(client *ga4.Client, project config.Project, service string) error {
	fmt.Printf("\n%s Unlinking service: %s\n", color.New(color.FgYellow).SprintFunc()("🔓"), service)

	switch service {
	case "bigquery", "bq":
		links, err := client.ListBigQueryLinks(project.PropertyID)
		if err != nil {
			return fmt.Errorf("could not list BigQuery links to unlink: %w", err)
		}
		if len(links) == 0 {
			_, _ = color.New(color.FgYellow).Println("No BigQuery links found to unlink.")
			return nil
		}
		for _, link := range links {
			fmt.Printf("Deleting link: %s\n", link.Name)
			if err := client.DeleteBigQueryLink(link.Name); err != nil {
				return fmt.Errorf("failed to delete BigQuery link %s: %w", link.Name, err)
			}
			_, _ = color.New(color.FgGreen).Printf("✓ Successfully deleted %s\n", link.Name)
		}

	case "channels":
		groups, err := client.ListChannelGroups(project.PropertyID)
		if err != nil {
			return fmt.Errorf("could not list channel groups to unlink: %w", err)
		}
		if len(groups) == 0 {
			_, _ = color.New(color.FgYellow).Println("No custom channel groups found to unlink.")
			return nil
		}
		for _, group := range groups {
			// We should not delete the system-defined "Primary Channel Group"
			if group.SystemDefined {
				continue
			}
			fmt.Printf("Deleting channel group: %s\n", group.Name)
			if err := client.DeleteChannelGroup(group.Name); err != nil {
				return fmt.Errorf("failed to delete channel group %s: %w", group.Name, err)
			}
			_, _ = color.New(color.FgGreen).Printf("✓ Successfully deleted %s\n", group.Name)
		}

	default:
		return fmt.Errorf("unlinking not supported for service: %s", service)
	}

	return nil
}
