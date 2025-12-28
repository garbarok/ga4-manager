package cmd

import (
	"fmt"
	"os"
	"strings"

	"github.com/garbarok/ga4-manager/internal/tui"
)

// handleExportAction handles the "Export Reports" menu action
// Single Responsibility: Export GA4 reports to various formats
func handleExportAction() {
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
		fmt.Println("\n💾 Exporting reports for all projects...")
	} else {
		reportAll = false
		reportConfigPath = projectPath
		fmt.Printf("\n💾 Preparing to export report for %s...\n", projectPath)
	}

	// Show format selection menu and execute export
	format := promptFormatSelection()
	if format != "" {
		executeExport(projectPath, format)
	}
}

// promptFormatSelection prompts user to select export format
// Interface Segregation: Focused on format selection only
func promptFormatSelection() string {
	fmt.Println("\n" + strings.Repeat("─", 50))
	fmt.Println("\n📦 Select export format:")
	fmt.Println("  1. JSON - Single file with all data")
	fmt.Println("  2. CSV - Multiple files (conversions, dimensions, metrics, etc.)")
	fmt.Println("  3. Markdown - Formatted report with tables")
	fmt.Println("  4. Cancel (return to menu)")
	fmt.Print("\nSelect option (1-4): ")

	var choice string
	_, _ = fmt.Scanln(&choice)

	switch choice {
	case "1":
		return "json"
	case "2":
		return "csv"
	case "3":
		return "markdown"
	case "4", "":
		fmt.Println("\nExport cancelled.")
		return ""
	default:
		fmt.Println("\nInvalid choice. Export cancelled.")
		return ""
	}
}
