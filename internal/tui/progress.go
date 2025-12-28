package tui

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// ProgressStep represents a step in the setup process
type ProgressStep struct {
	Name      string
	Status    StepStatus
	Message   string
	StartTime time.Time
	Duration  time.Duration
}

// StepStatus represents the status of a step
type StepStatus int

const (
	StepPending StepStatus = iota
	StepRunning
	StepCompleted
	StepFailed
	StepSkipped
)

// ProgressModel is the Bubble Tea model for setup progress
type ProgressModel struct {
	steps     []ProgressStep
	current   int
	spinner   spinner.Model
	quitting  bool
	startTime time.Time
}

// progressMsg is sent when a step status changes
type progressMsg struct {
	stepIndex int
	status    StepStatus
	message   string
}

// NewProgressModel creates a new progress model
func NewProgressModel(stepNames []string) ProgressModel {
	steps := make([]ProgressStep, len(stepNames))
	for i, name := range stepNames {
		steps[i] = ProgressStep{
			Name:   name,
			Status: StepPending,
		}
	}

	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("#4ECDC4"))

	return ProgressModel{
		steps:     steps,
		current:   0,
		spinner:   s,
		startTime: time.Now(),
	}
}

// Init initializes the model
func (m ProgressModel) Init() tea.Cmd {
	return m.spinner.Tick
}

// Update handles messages
func (m ProgressModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "q":
			m.quitting = true
			return m, tea.Quit
		}

	case progressMsg:
		if msg.stepIndex >= 0 && msg.stepIndex < len(m.steps) {
			m.steps[msg.stepIndex].Status = msg.status
			m.steps[msg.stepIndex].Message = msg.message

			switch msg.status {
			case StepRunning:
				m.steps[msg.stepIndex].StartTime = time.Now()
				m.current = msg.stepIndex
			case StepCompleted, StepFailed:
				m.steps[msg.stepIndex].Duration = time.Since(m.steps[msg.stepIndex].StartTime)
			}

			// Check if all steps are done
			allDone := true
			for _, step := range m.steps {
				if step.Status == StepPending || step.Status == StepRunning {
					allDone = false
					break
				}
			}
			if allDone {
				m.quitting = true
				return m, tea.Quit
			}
		}
		return m, nil

	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd
	}

	return m, nil
}

// View renders the UI
func (m ProgressModel) View() string {
	if m.quitting {
		return ""
	}

	var b strings.Builder

	// Title
	titleStyle := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("#FF6B6B")).
		Padding(1, 0)

	b.WriteString(titleStyle.Render("🚀 GA4 Manager - Setup Progress"))
	b.WriteString("\n")
	b.WriteString(strings.Repeat("═", 50))
	b.WriteString("\n\n")

	// Steps
	for i, step := range m.steps {
		b.WriteString(m.renderStep(i, step))
		b.WriteString("\n")
	}

	// Summary
	b.WriteString("\n")
	b.WriteString(m.renderSummary())

	return b.String()
}

// renderStep renders a single step
func (m ProgressModel) renderStep(index int, step ProgressStep) string {
	var icon string
	var style lipgloss.Style

	switch step.Status {
	case StepPending:
		icon = "⏸"
		style = lipgloss.NewStyle().Foreground(lipgloss.Color("#95A3A4"))
	case StepRunning:
		icon = m.spinner.View()
		style = lipgloss.NewStyle().Foreground(lipgloss.Color("#4ECDC4")).Bold(true)
	case StepCompleted:
		icon = "✓"
		style = lipgloss.NewStyle().Foreground(lipgloss.Color("#4ECDC4"))
	case StepFailed:
		icon = "✗"
		style = lipgloss.NewStyle().Foreground(lipgloss.Color("#FF6B6B"))
	case StepSkipped:
		icon = "○"
		style = lipgloss.NewStyle().Foreground(lipgloss.Color("#FFE66D"))
	}

	line := fmt.Sprintf("[%d/%d] %s %s", index+1, len(m.steps), icon, step.Name)

	if step.Message != "" {
		line += fmt.Sprintf("\n      %s", step.Message)
	}

	if step.Duration > 0 {
		line += fmt.Sprintf(" (%s)", step.Duration.Round(time.Millisecond))
	}

	return style.Render(line)
}

// renderSummary renders the summary section
func (m ProgressModel) renderSummary() string {
	completed := 0
	failed := 0
	skipped := 0

	for _, step := range m.steps {
		switch step.Status {
		case StepCompleted:
			completed++
		case StepFailed:
			failed++
		case StepSkipped:
			skipped++
		}
	}

	totalDuration := time.Since(m.startTime)

	summaryStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("#95A3A4")).
		Italic(true)

	summary := fmt.Sprintf("Progress: %d completed", completed)
	if failed > 0 {
		summary += fmt.Sprintf(", %d failed", failed)
	}
	if skipped > 0 {
		summary += fmt.Sprintf(", %d skipped", skipped)
	}
	summary += fmt.Sprintf(" | Duration: %s", totalDuration.Round(time.Millisecond))

	return summaryStyle.Render(summary)
}

// UpdateStep updates the status of a step
func UpdateStep(stepIndex int, status StepStatus, message string) tea.Msg {
	return progressMsg{
		stepIndex: stepIndex,
		status:    status,
		message:   message,
	}
}
