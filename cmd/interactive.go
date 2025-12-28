package cmd

import (
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/garbarok/ga4-manager/internal/tui"
	"github.com/spf13/cobra"
)

var interactiveCmd = &cobra.Command{
	Use:   "interactive",
	Short: "Launch interactive menu (default when no args)",
	Long:  `Launch an interactive terminal UI to navigate GA4 Manager commands.`,
	Run: func(cmd *cobra.Command, args []string) {
		RunInteractive()
	},
}

func init() {
	rootCmd.AddCommand(interactiveCmd)
}

// RunInteractive launches the TUI and handles the selected action
// Single Responsibility: Main interactive loop and action routing
func RunInteractive() {
	// Ensure config directory exists on first run
	if err := ensureConfigDirectoryExists(); err != nil {
		fmt.Fprintf(os.Stderr, "Error setting up config directory: %v\n", err)
		os.Exit(1)
	}

	// Offer auto-install if running from non-standard location
	offerAutoInstall()

	for {
		// Create and run the menu model
		m := tui.NewMenuModel(Version)
		p := tea.NewProgram(m)

		finalModel, err := p.Run()
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error running interactive menu: %v\n", err)
			os.Exit(1)
		}

		// Get the selected action
		menuModel, ok := finalModel.(tui.MenuModel)
		if !ok {
			fmt.Fprintln(os.Stderr, "Error: unexpected model type")
			os.Exit(1)
		}

		selected := menuModel.GetSelected()

		// Route to appropriate handler (Dependency Inversion: handlers are in separate files)
		if !routeAction(selected) {
			return // Exit was selected
		}

		// Pause before returning to menu
		if selected != "link" && selected != "exit" {
			fmt.Println("\nPress Enter to return to menu...")
			fmt.Scanln()
		}
	}
}

// routeAction routes the selected action to its handler
// Open/Closed Principle: Easy to extend with new actions
// Returns false if user wants to exit
func routeAction(action string) bool {
	switch action {
	case "init":
		runInitWizard()
	case "report":
		handleReportAction()
	case "export":
		handleExportAction()
	case "setup":
		handleSetupAction()
	case "cleanup":
		handleCleanupAction()
	case "link":
		handleLinkAction()
	case "validate":
		handleValidateAction()
	case "exit":
		return false
	default:
		fmt.Fprintf(os.Stderr, "Unknown action: %s\n", action)
	}
	return true
}
