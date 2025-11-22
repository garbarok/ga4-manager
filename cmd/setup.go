package cmd

import (
	"fmt"

	"github.com/fatih/color"
	"github.com/spf13/cobra"
	"github.com/oscargallego/ga4-manager/internal/config"
	"github.com/oscargallego/ga4-manager/internal/ga4"
)

var (
	projectName string
	setupAll    bool
)

var setupCmd = &cobra.Command{
	Use:   "setup",
	Short: "Setup GA4 configuration for your projects",
	Long:  `Automatically create conversions, custom dimensions, and audiences for your GA4 properties.`,
	RunE:  runSetup,
}

func init() {
	rootCmd.AddCommand(setupCmd)
	setupCmd.Flags().StringVarP(&projectName, "project", "p", "", "Project name (snapcompress or personal)")
	setupCmd.Flags().BoolVarP(&setupAll, "all", "a", false, "Setup all projects")
}

func runSetup(cmd *cobra.Command, args []string) error {
	green := color.New(color.FgGreen).SprintFunc()
	yellow := color.New(color.FgYellow).SprintFunc()
	red := color.New(color.FgRed).SprintFunc()
	
	fmt.Println("🚀 GA4 Manager - Setup")
	fmt.Println("═══════════════════════════════════════════════")
	fmt.Println()

	// Create GA4 client
	client, err := ga4.NewClient()
	if err != nil {
		return fmt.Errorf("failed to create GA4 client: %w", err)
	}

	// Determine which projects to setup
	var projects []config.Project
	if setupAll {
		projects = config.AllProjects
	} else if projectName != "" {
		switch projectName {
		case "snapcompress", "snap":
			projects = []config.Project{config.SnapCompress}
		case "personal", "blog":
			projects = []config.Project{config.PersonalWebsite}
		default:
			return fmt.Errorf("unknown project: %s (use 'snapcompress' or 'personal')", projectName)
		}
	} else {
		return fmt.Errorf("specify --project or --all")
	}

	// Setup each project
	for _, project := range projects {
		fmt.Printf("\n📦 Setting up: %s (Property: %s)\n", project.Name, project.PropertyID)
		fmt.Println("───────────────────────────────────────────────")

		// Setup conversions
		fmt.Printf("\n🎯 Creating conversions...\n")
		for _, conv := range project.Conversions {
			err := client.CreateConversion(project.PropertyID, conv.Name, conv.CountingMethod)
			if err != nil {
				fmt.Printf("  %s %s: %s\n", red("✗"), conv.Name, err)
			} else {
				fmt.Printf("  %s %s\n", green("✓"), conv.Name)
			}
		}

		// Setup dimensions
		fmt.Printf("\n📊 Creating custom dimensions...\n")
		for _, dim := range project.Dimensions {
			err := client.CreateDimension(project.PropertyID, dim)
			if err != nil {
				fmt.Printf("  %s %s: %s\n", red("✗"), dim.DisplayName, err)
			} else {
				fmt.Printf("  %s %s\n", green("✓"), dim.DisplayName)
			}
		}

		// Note about audiences
		fmt.Printf("\n👥 Audiences (manual setup required):\n")
		for _, aud := range project.Audiences {
			fmt.Printf("  %s %s\n", yellow("○"), aud.Name)
		}
		fmt.Printf("  ℹ️  Audiences must be created manually in GA4 UI\n")
	}

	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════")
	fmt.Printf("%s Setup complete!\n", green("✅"))
	fmt.Println()
	fmt.Println("Next steps:")
	fmt.Println("1. Verify in GA4: https://analytics.google.com")
	fmt.Println("2. Implement event tracking in your apps")
	fmt.Println("3. Test events in GA4 DebugView")
	fmt.Println()

	return nil
}
