package cmd

import (
	"fmt"
	"os"

	"github.com/garbarok/ga4-manager/internal/tui"
)

// handleSetupAction handles the "Setup Projects" menu action
// Single Responsibility: Setup GA4 conversions, dimensions, and metrics
func handleSetupAction() {
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
		setupAll = true
		configPath = ""
		fmt.Println("\n⚙️  Running setup for all projects...")
	} else {
		setupAll = false
		configPath = projectPath
		fmt.Printf("\n⚙️  Running setup for %s...\n", projectPath)
	}
	fmt.Println()

	// Run the setup command
	if err := runSetup(setupCmd, nil); err != nil {
		fmt.Fprintf(os.Stderr, "\n❌ Error running setup: %v\n", err)
	}
}
