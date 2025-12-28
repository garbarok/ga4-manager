package tui

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/charmbracelet/bubbles/list"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"gopkg.in/yaml.v3"
)

// ProjectItem represents a selectable project configuration
type ProjectItem struct {
	Name       string
	Path       string
	PropertyID string
	Desc       string
	IsAll      bool // Special "All Projects" option
	IsBack     bool // Special "Back" option
}

// Implement list.Item interface
func (i ProjectItem) FilterValue() string { return i.Name }
func (i ProjectItem) Title() string       { return i.Name }
func (i ProjectItem) Description() string {
	if i.IsBack {
		return "Return to main menu"
	}
	if i.IsAll {
		return "Run command on all projects in configs/"
	}
	desc := i.Desc
	if i.PropertyID != "" {
		desc += fmt.Sprintf(" (Property: %s)", i.PropertyID)
	}
	return desc
}

// ProjectSelectorModel is the Bubble Tea model for project selection
type ProjectSelectorModel struct {
	list     list.Model
	choice   string
	quitting bool
}

// NewProjectSelector creates a new project selector
func NewProjectSelector() (*ProjectSelectorModel, error) {
	items, err := scanProjects()
	if err != nil {
		return nil, err
	}

	if len(items) == 0 {
		return nil, fmt.Errorf("no project configurations found in configs/ directory")
	}

	// Create list
	l := list.New(items, list.NewDefaultDelegate(), 0, 0)
	l.Title = "Select a Project"
	l.SetShowStatusBar(false)
	l.SetFilteringEnabled(true)
	l.Styles.Title = lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("#FF6B6B")).
		Padding(0, 1)

	return &ProjectSelectorModel{
		list: l,
	}, nil
}

// Init initializes the model
func (m ProjectSelectorModel) Init() tea.Cmd {
	return nil
}

// Update handles messages
func (m ProjectSelectorModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.list.SetWidth(msg.Width)
		m.list.SetHeight(msg.Height - 2)
		return m, nil

	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "q", "esc":
			m.quitting = true
			m.choice = ""
			return m, tea.Quit

		case "enter":
			item, ok := m.list.SelectedItem().(ProjectItem)
			if ok {
				m.choice = item.Path
				m.quitting = true
			}
			return m, tea.Quit
		}
	}

	var cmd tea.Cmd
	m.list, cmd = m.list.Update(msg)
	return m, cmd
}

// View renders the UI
func (m ProjectSelectorModel) View() string {
	if m.quitting {
		return ""
	}
	return "\n" + m.list.View()
}

// GetChoice returns the selected project path
func (m ProjectSelectorModel) GetChoice() string {
	return m.choice
}

// scanProjects scans the configs/ directory for project YAML files
func scanProjects() ([]list.Item, error) {
	var items []list.Item

	// Add "Back to Menu" option first
	items = append(items, ProjectItem{
		Name:   "← Back to Menu",
		Path:   "--back",
		IsBack: true,
	})

	// Add "All Projects" option
	items = append(items, ProjectItem{
		Name:  "All Projects",
		Path:  "--all",
		IsAll: true,
	})

	// Check if configs directory exists
	configsDir := "configs"
	if _, err := os.Stat(configsDir); os.IsNotExist(err) {
		return items, nil // Return just the "All" option if no configs dir
	}

	// Walk the configs directory
	err := filepath.Walk(configsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Skip directories and non-YAML files
		if info.IsDir() || (!strings.HasSuffix(path, ".yaml") && !strings.HasSuffix(path, ".yml")) {
			return nil
		}

		// Skip example files
		if strings.Contains(path, "examples/") {
			return nil
		}

		// Parse the YAML file to get project info
		project, err := parseProjectFile(path)
		if err != nil {
			// Skip files that can't be parsed, but log the error
			fmt.Fprintf(os.Stderr, "Warning: skipping %s: %v\n", path, err)
			return nil
		}

		items = append(items, project)
		return nil
	})

	if err != nil {
		return nil, err
	}

	return items, nil
}

// ProjectConfig represents the minimal YAML structure we need to parse
type ProjectConfig struct {
	Project struct {
		Name        string `yaml:"name"`
		Description string `yaml:"description"`
	} `yaml:"project"`
	GA4 struct {
		PropertyID string `yaml:"property_id"`
	} `yaml:"ga4"`
}

// parseProjectFile parses a YAML config file and extracts project info
func parseProjectFile(path string) (ProjectItem, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return ProjectItem{}, err
	}

	var config ProjectConfig
	if err := yaml.Unmarshal(data, &config); err != nil {
		return ProjectItem{}, err
	}

	// Use filename if no project name is set
	name := config.Project.Name
	if name == "" {
		name = filepath.Base(path)
		name = strings.TrimSuffix(name, filepath.Ext(name))
	}

	return ProjectItem{
		Name:       name,
		Path:       path,
		PropertyID: config.GA4.PropertyID,
		Desc:       config.Project.Description,
		IsAll:      false,
	}, nil
}

// ErrBackToMenu is returned when user selects "Back to Menu"
var ErrBackToMenu = fmt.Errorf("back to menu")

// RunProjectSelector runs the project selector and returns the selected path
func RunProjectSelector() (string, error) {
	model, err := NewProjectSelector()
	if err != nil {
		return "", err
	}

	p := tea.NewProgram(model, tea.WithAltScreen())
	finalModel, err := p.Run()
	if err != nil {
		return "", err
	}

	selectorModel, ok := finalModel.(ProjectSelectorModel)
	if !ok {
		return "", fmt.Errorf("unexpected model type")
	}

	choice := selectorModel.GetChoice()
	if choice == "" {
		return "", fmt.Errorf("no project selected")
	}

	// Handle back to menu
	if choice == "--back" {
		return "", ErrBackToMenu
	}

	return choice, nil
}
