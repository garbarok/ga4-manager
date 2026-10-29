package tui

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
)

// MenuItem represents a menu option
type MenuItem struct {
	Title       string
	Description string
	Icon        string
	Action      string
}

// MenuModel is the Bubble Tea model for the main menu
type MenuModel struct {
	items    []MenuItem
	cursor   int
	selected string
	quitting bool
	version  string
}

// NewMenuModel creates a new menu model
func NewMenuModel(version string) MenuModel {
	items := []MenuItem{
		{
			Title:       "Initial Setup (Credentials)",
			Description: "Configure Google Cloud credentials",
			Icon:        "🔧",
			Action:      "init",
		},
		{
			Title:       "View Reports",
			Description: "Show GA4 property configuration",
			Icon:        "📊",
			Action:      "report",
		},
		{
			Title:       "Export Reports",
			Description: "Export reports to JSON, CSV, or Markdown",
			Icon:        "💾",
			Action:      "export",
		},
		{
			Title:       "Setup Projects",
			Description: "Create conversions, dimensions, and metrics",
			Icon:        "⚙️",
			Action:      "setup",
		},
		{
			Title:       "Cleanup Unused Items",
			Description: "Remove unused conversions, dimensions, metrics",
			Icon:        "🧹",
			Action:      "cleanup",
		},
		{
			Title:       "Manage Links",
			Description: "Link Search Console, BigQuery, Channels",
			Icon:        "🔗",
			Action:      "link",
		},
		{
			Title:       "Validate Configs",
			Description: "Check YAML configuration files",
			Icon:        "✅",
			Action:      "validate",
		},
		{
			Title:       "Exit",
			Description: "Quit GA4 Manager",
			Icon:        "❌",
			Action:      "exit",
		},
	}

	return MenuModel{
		items:   items,
		cursor:  0,
		version: version,
	}
}

// Init initializes the model
func (m MenuModel) Init() tea.Cmd {
	return nil
}

// Update handles messages
func (m MenuModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "q", "esc":
			m.quitting = true
			m.selected = "exit"
			return m, tea.Quit

		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}

		case "down", "j":
			if m.cursor < len(m.items)-1 {
				m.cursor++
			}

		case "enter", " ":
			m.selected = m.items[m.cursor].Action
			m.quitting = true
			return m, tea.Quit
		}
	}

	return m, nil
}

// View renders the UI
func (m MenuModel) View() string {
	if m.quitting {
		return ""
	}

	// Title
	title := titleStyle.Render(fmt.Sprintf("GA4 Manager v%s", m.version))
	s := title + "\n\n"

	// Menu items
	for i, item := range m.items {
		cursor := "  "
		itemStyle := normalItemStyle

		if m.cursor == i {
			cursor = "→ "
			itemStyle = selectedItemStyle
		}

		line := fmt.Sprintf("%s %s %s", cursor, item.Icon, item.Title)
		s += itemStyle.Render(line) + "\n"
	}

	// Help text
	help := helpStyle.Render("\n↑/k up • ↓/j down • enter/space select • q/esc quit")
	s += help

	return s
}

// GetSelected returns the selected action
func (m MenuModel) GetSelected() string {
	return m.selected
}
