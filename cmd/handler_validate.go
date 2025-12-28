package cmd

import (
	"fmt"
	"os"

	"github.com/garbarok/ga4-manager/internal/tui"
)

// handleValidateAction handles the "Validate Configs" menu action
// Single Responsibility: Validate YAML configuration files
func handleValidateAction() {
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
	var args []string
	if projectPath == "--all" {
		validateAll = true
		fmt.Println("\n✅ Validating all configurations...")
	} else {
		validateAll = false
		args = []string{projectPath}
		fmt.Printf("\n✅ Validating %s...\n", projectPath)
	}
	fmt.Println()

	// Run the validate command
	if err := runValidate(validateCmd, args); err != nil {
		fmt.Fprintf(os.Stderr, "\n❌ Error running validate: %v\n", err)
	}
}
