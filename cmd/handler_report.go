package cmd

import (
	"fmt"
	"os"
	"strings"

	"github.com/garbarok/ga4-manager/internal/ga4"
	"github.com/garbarok/ga4-manager/internal/tui"
)

// handleReportAction handles the "View Reports" menu action
// Single Responsibility: Display GA4 reports with optional export
func handleReportAction() {
	// Run project selector
	projectPath, err := tui.RunProjectSelector()
	if err != nil {
		if err == tui.ErrBackToMenu || err.Error() == "no project selected" {
			return // Go back to main menu
		}
		fmt.Fprintf(os.Stderr, "Error selecting project: %v\n", err)
		return
	}

	// Set flags based on selection
	if projectPath == "--all" {
		reportAll = true
		reportConfigPath = ""
		fmt.Println("\n📊 Loading reports for all projects...")
	} else {
		reportAll = false
		reportConfigPath = projectPath
		fmt.Printf("\n📊 Loading report for %s...\n", projectPath)
	}
	fmt.Println()

	// Run the report command (display mode)
	reportExport = "" // Clear export flag for display
	if err := runReport(reportCmd, nil); err != nil {
		fmt.Fprintf(os.Stderr, "\n❌ Error running report: %v\n", err)
		return
	}

	// After displaying, ask if user wants to export
	promptReportExport(projectPath)
}

// promptReportExport prompts the user to export the report after viewing
func promptReportExport(projectPath string) {
	fmt.Println("\n" + strings.Repeat("─", 50))
	fmt.Println("\n💾 Would you like to export this report?")
	fmt.Println("  1. Export as JSON")
	fmt.Println("  2. Export as CSV (multiple files)")
	fmt.Println("  3. Export as Markdown")
	fmt.Println("  4. Skip export (return to menu)")
	fmt.Print("\nSelect option (1-4): ")

	var choice string
	fmt.Scanln(&choice)

	switch choice {
	case "1":
		executeExport(projectPath, "json")
	case "2":
		executeExport(projectPath, "csv")
	case "3":
		executeExport(projectPath, "markdown")
	case "4", "":
		// Skip export, return to menu
		return
	default:
		fmt.Println("Invalid choice, skipping export.")
	}
}

// executeExport performs the actual export operation
func executeExport(projectPath, format string) {
	fmt.Printf("\n📤 Exporting as %s...\n\n", strings.ToUpper(format))

	// Create GA4 client
	client, err := ga4.NewClient()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error creating client: %v\n", err)
		return
	}

	// Load projects
	projects, err := loadProjects(projectPath, "", reportAll)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error loading projects: %v\n", err)
		return
	}

	// Export with auto-generated filename
	if err := exportReports(client, projects, format, ""); err != nil {
		fmt.Fprintf(os.Stderr, "Error exporting report: %v\n", err)
	}
}
