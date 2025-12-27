package setup

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/fatih/color"
)

// StepStatus represents the status of a setup step
type StepStatus int

const (
	StepPending StepStatus = iota
	StepInProgress
	StepCompleted
	StepFailed
	StepSkipped
)

// String returns the string representation of StepStatus
func (s StepStatus) String() string {
	switch s {
	case StepPending:
		return "pending"
	case StepInProgress:
		return "in_progress"
	case StepCompleted:
		return "completed"
	case StepFailed:
		return "failed"
	case StepSkipped:
		return "skipped"
	default:
		return "unknown"
	}
}

// SetupStep represents a single step in the setup process
type SetupStep struct {
	Name        string
	Description string
	Status      StepStatus
	StartTime   time.Time
	EndTime     time.Time
	Error       error
	Details     string
	SubSteps    []SubStep
}

// SubStep represents a sub-task within a setup step
type SubStep struct {
	Name    string
	Status  StepStatus
	Error   error
	Details string
}

// Duration returns the duration of the step
func (s *SetupStep) Duration() time.Duration {
	if s.EndTime.IsZero() {
		return time.Since(s.StartTime)
	}
	return s.EndTime.Sub(s.StartTime)
}

// ProgressTracker tracks the progress of the setup process
type ProgressTracker struct {
	totalSteps  int
	currentStep int
	steps       []*SetupStep
	startTime   time.Time
	endTime     time.Time
	mu          sync.Mutex
}

// NewProgressTracker creates a new progress tracker
func NewProgressTracker() *ProgressTracker {
	return &ProgressTracker{
		steps:     make([]*SetupStep, 0),
		startTime: time.Now(),
	}
}

// AddStep adds a new step to track
func (pt *ProgressTracker) AddStep(name, description string) {
	pt.mu.Lock()
	defer pt.mu.Unlock()

	step := &SetupStep{
		Name:        name,
		Description: description,
		Status:      StepPending,
		SubSteps:    make([]SubStep, 0),
	}

	pt.steps = append(pt.steps, step)
	pt.totalSteps++
}

// StartStep marks a step as in progress
func (pt *ProgressTracker) StartStep(name string) {
	pt.mu.Lock()
	defer pt.mu.Unlock()

	for _, step := range pt.steps {
		if step.Name == name {
			step.Status = StepInProgress
			step.StartTime = time.Now()
			pt.currentStep++
			break
		}
	}
}

// CompleteStep marks a step as completed
func (pt *ProgressTracker) CompleteStep(name string, details string) {
	pt.mu.Lock()
	defer pt.mu.Unlock()

	for _, step := range pt.steps {
		if step.Name == name {
			step.Status = StepCompleted
			step.EndTime = time.Now()
			step.Details = details
			break
		}
	}
}

// FailStep marks a step as failed
func (pt *ProgressTracker) FailStep(name string, err error) {
	pt.mu.Lock()
	defer pt.mu.Unlock()

	for _, step := range pt.steps {
		if step.Name == name {
			step.Status = StepFailed
			step.EndTime = time.Now()
			step.Error = err
			break
		}
	}
}

// SkipStep marks a step as skipped
func (pt *ProgressTracker) SkipStep(name string, reason string) {
	pt.mu.Lock()
	defer pt.mu.Unlock()

	for _, step := range pt.steps {
		if step.Name == name {
			step.Status = StepSkipped
			step.EndTime = time.Now()
			step.Details = reason
			break
		}
	}
}

// AddSubStep adds a sub-step to the current step
func (pt *ProgressTracker) AddSubStep(stepName, subStepName string, status StepStatus, details string) {
	pt.mu.Lock()
	defer pt.mu.Unlock()

	for _, step := range pt.steps {
		if step.Name == stepName {
			step.SubSteps = append(step.SubSteps, SubStep{
				Name:    subStepName,
				Status:  status,
				Details: details,
			})
			break
		}
	}
}

// Finish marks the entire setup as complete
func (pt *ProgressTracker) Finish() {
	pt.mu.Lock()
	defer pt.mu.Unlock()
	pt.endTime = time.Now()
}

// Duration returns the total duration of the setup
func (pt *ProgressTracker) Duration() time.Duration {
	pt.mu.Lock()
	defer pt.mu.Unlock()
	return pt.durationUnlocked()
}

// durationUnlocked calculates duration without acquiring the lock (internal use)
func (pt *ProgressTracker) durationUnlocked() time.Duration {
	if pt.endTime.IsZero() {
		return time.Since(pt.startTime)
	}
	return pt.endTime.Sub(pt.startTime)
}

// GetStep returns a step by name
func (pt *ProgressTracker) GetStep(name string) *SetupStep {
	pt.mu.Lock()
	defer pt.mu.Unlock()

	for _, step := range pt.steps {
		if step.Name == name {
			return step
		}
	}
	return nil
}

// GetAllSteps returns all steps
func (pt *ProgressTracker) GetAllSteps() []*SetupStep {
	pt.mu.Lock()
	defer pt.mu.Unlock()
	return pt.steps
}

// RenderProgress returns a formatted string showing current progress
func (pt *ProgressTracker) RenderProgress() string {
	pt.mu.Lock()
	defer pt.mu.Unlock()

	var sb strings.Builder

	green := color.New(color.FgGreen).SprintFunc()
	yellow := color.New(color.FgYellow).SprintFunc()
	red := color.New(color.FgRed).SprintFunc()
	blue := color.New(color.FgBlue).SprintFunc()
	gray := color.New(color.FgHiBlack).SprintFunc()

	for i, step := range pt.steps {
		// Step header
		stepNum := fmt.Sprintf("[%d/%d]", i+1, pt.totalSteps)

		var statusIcon string
		switch step.Status {
		case StepPending:
			statusIcon = gray("○")
		case StepInProgress:
			statusIcon = blue("◐")
		case StepCompleted:
			statusIcon = green("✓")
		case StepFailed:
			statusIcon = red("✗")
		case StepSkipped:
			statusIcon = yellow("⊗")
		}

		sb.WriteString(fmt.Sprintf("\n%s %s %s\n", stepNum, statusIcon, step.Name))

		// Step details
		if step.Details != "" {
			sb.WriteString(fmt.Sprintf("  %s\n", gray(step.Details)))
		}

		// Sub-steps
		for _, subStep := range step.SubSteps {
			var subIcon string
			switch subStep.Status {
			case StepCompleted:
				subIcon = green("✓")
			case StepFailed:
				subIcon = red("✗")
			case StepSkipped:
				subIcon = yellow("○")
			default:
				subIcon = gray("○")
			}

			sb.WriteString(fmt.Sprintf("  %s %s", subIcon, subStep.Name))
			if subStep.Details != "" {
				sb.WriteString(fmt.Sprintf(" %s", gray(fmt.Sprintf("(%s)", subStep.Details))))
			}
			sb.WriteString("\n")
		}

		// Error message
		if step.Error != nil {
			sb.WriteString(fmt.Sprintf("  %s %s\n", red("Error:"), step.Error.Error()))
		}
	}

	return sb.String()
}

// GenerateSummary generates a summary of the setup
func (pt *ProgressTracker) GenerateSummary() string {
	pt.mu.Lock()
	defer pt.mu.Unlock()

	var sb strings.Builder

	green := color.New(color.FgGreen).SprintFunc()
	yellow := color.New(color.FgYellow).SprintFunc()
	red := color.New(color.FgRed).SprintFunc()

	// Count step statuses
	completed := 0
	failed := 0
	skipped := 0

	for _, step := range pt.steps {
		switch step.Status {
		case StepCompleted:
			completed++
		case StepFailed:
			failed++
		case StepSkipped:
			skipped++
		}
	}

	// Overall status
	sb.WriteString("\n")
	sb.WriteString("═══════════════════════════════════════════════\n")

	if failed > 0 {
		sb.WriteString(fmt.Sprintf("%s Setup failed!\n", red("✗")))
	} else if completed == pt.totalSteps {
		sb.WriteString(fmt.Sprintf("%s Setup complete!\n", green("✅")))
	} else {
		sb.WriteString(fmt.Sprintf("%s Setup completed with warnings\n", yellow("⚠️")))
	}

	sb.WriteString("\n")

	// Statistics
	sb.WriteString("Setup Summary:\n")
	if completed > 0 {
		sb.WriteString(fmt.Sprintf("  %s %d steps completed\n", green("✓"), completed))
	}
	if skipped > 0 {
		sb.WriteString(fmt.Sprintf("  %s %d steps skipped\n", yellow("○"), skipped))
	}
	if failed > 0 {
		sb.WriteString(fmt.Sprintf("  %s %d steps failed\n", red("✗"), failed))
	}

	// Duration (use unlocked version since we already hold the lock)
	duration := pt.durationUnlocked()
	sb.WriteString(fmt.Sprintf("  Duration: %.1f seconds\n", duration.Seconds()))

	return sb.String()
}

// HasFailures returns true if any step failed
func (pt *ProgressTracker) HasFailures() bool {
	pt.mu.Lock()
	defer pt.mu.Unlock()

	for _, step := range pt.steps {
		if step.Status == StepFailed {
			return true
		}
	}
	return false
}

// GetFailedSteps returns all failed steps
func (pt *ProgressTracker) GetFailedSteps() []*SetupStep {
	pt.mu.Lock()
	defer pt.mu.Unlock()

	failed := make([]*SetupStep, 0)
	for _, step := range pt.steps {
		if step.Status == StepFailed {
			failed = append(failed, step)
		}
	}
	return failed
}
