package cmd

import (
	"fmt"

	"github.com/fatih/color"
	"github.com/olekukonko/tablewriter"
	"github.com/spf13/cobra"
	"github.com/oscargallego/ga4-manager/internal/config"
	"github.com/oscargallego/ga4-manager/internal/ga4"
	"os"
)

var reportCmd = &cobra.Command{
	Use:   "report",
	Short: "Show quick reports for your projects",
	Long:  `Display current configuration and quick statistics.`,
	RunE:  runReport,
}

func init() {
	rootCmd.AddCommand(reportCmd)
	reportCmd.Flags().StringVarP(&projectName, "project", "p", "", "Project name (snapcompress or personal)")
}

func runReport(cmd *cobra.Command, args []string) error {
	cyan := color.New(color.FgCyan).SprintFunc()
	
	fmt.Printf("%s GA4 Configuration Report\n", cyan("📊"))
	fmt.Println("═══════════════════════════════════════════════")
	fmt.Println()

	// Create GA4 client
	client, err := ga4.NewClient()
	if err != nil {
		return fmt.Errorf("failed to create GA4 client: %w", err)
	}

	// Determine which project to report on
	var project config.Project
	if projectName == "" || projectName == "snapcompress" || projectName == "snap" {
		project = config.SnapCompress
	} else {
		project = config.PersonalWebsite
	}

	fmt.Printf("Project: %s\n", project.Name)
	fmt.Printf("Property ID: %s\n\n", project.PropertyID)

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

	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════")
	
	return nil
}
