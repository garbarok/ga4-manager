package cmd

import (
	"fmt"
	"os"

	"github.com/garbarok/ga4-manager/internal/tui"
)

// handleCleanupAction handles the "Cleanup Unused Items" menu action
// Single Responsibility: Remove unused conversions, dimensions, and metrics
func handleCleanupAction() {
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
		cleanupAllProjects = true
		cleanupConfigPath = ""
	} else {
		cleanupAllProjects = false
		cleanupConfigPath = projectPath
	}

	// Default to dry-run for safety
	cleanupDryRun = true
	cleanupType = "all"

	fmt.Println("\n🧹 Running cleanup in dry-run mode (preview only)...")
	fmt.Println("To apply changes, use: ga4 cleanup --config", projectPath)
	fmt.Println()

	// Run the cleanup command
	if err := runCleanup(cleanupCmd, nil); err != nil {
		fmt.Fprintf(os.Stderr, "Error running cleanup: %v\n", err)
	}
}
