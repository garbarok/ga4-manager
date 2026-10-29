package tui

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
)

// SetupProgressWrapper wraps the setup command with progress UI
type SetupProgressWrapper struct {
	program    *tea.Program
	stepNames  []string
	setupFunc  func() error
	setupDone  bool
	setupError error
}

// NewSetupProgressWrapper creates a new setup progress wrapper
func NewSetupProgressWrapper(stepNames []string, setupFunc func() error) *SetupProgressWrapper {
	return &SetupProgressWrapper{
		stepNames: stepNames,
		setupFunc: setupFunc,
	}
}

// Run executes the setup with progress UI
func (w *SetupProgressWrapper) Run() error {
	// Create progress model
	model := NewProgressModel(w.stepNames)

	// Start the Bubble Tea program
	w.program = tea.NewProgram(model)

	// Run setup in background
	go w.runSetup()

	// Run the UI
	if _, err := w.program.Run(); err != nil {
		return fmt.Errorf("error running progress UI: %w", err)
	}

	// Return any error from setup
	return w.setupError
}

// runSetup executes the actual setup function
func (w *SetupProgressWrapper) runSetup() {
	// Execute each step
	for i := range w.stepNames {
		// Update to running
		w.program.Send(UpdateStep(i, StepRunning, ""))

		// For now, we just mark steps as they would execute
		// In the future, this could be integrated with the actual setup orchestrator

		// Mark as completed
		w.program.Send(UpdateStep(i, StepCompleted, ""))
	}

	// Execute the actual setup
	err := w.setupFunc()
	w.setupError = err
	w.setupDone = true

	// Quit the program
	w.program.Quit()
}

// CreateStandardSetupSteps returns standard setup step names
func CreateStandardSetupSteps(hasGA4, hasGSC bool) []string {
	var steps []string

	if hasGA4 && hasGSC {
		steps = []string{
			"Pre-flight validation",
			"Google Analytics 4 Setup",
			"Google Search Console Setup",
			"Finalization",
		}
	} else if hasGA4 {
		steps = []string{
			"Pre-flight validation",
			"Google Analytics 4 Setup",
			"Finalization",
		}
	} else if hasGSC {
		steps = []string{
			"Pre-flight validation",
			"Google Search Console Setup",
			"Finalization",
		}
	} else {
		steps = []string{
			"Pre-flight validation",
			"Finalization",
		}
	}

	return steps
}
