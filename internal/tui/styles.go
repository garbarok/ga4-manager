package tui

import (
	"github.com/charmbracelet/lipgloss"
)

var (
	// Color palette
	primaryColor   = lipgloss.Color("#FF6B6B")
	secondaryColor = lipgloss.Color("#4ECDC4")
	accentColor    = lipgloss.Color("#FFE66D")
	textColor      = lipgloss.Color("#F7FFF7")
	dimColor       = lipgloss.Color("#95A3A4")
	borderColor    = lipgloss.Color("#6C5CE7")

	// Title style
	titleStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(primaryColor).
			Padding(1, 2).
			Border(lipgloss.RoundedBorder()).
			BorderForeground(borderColor)

	// Menu item styles
	selectedItemStyle = lipgloss.NewStyle().
				Foreground(accentColor).
				Bold(true).
				PaddingLeft(2)

	normalItemStyle = lipgloss.NewStyle().
			Foreground(textColor).
			PaddingLeft(4)

	// Help text style
	helpStyle = lipgloss.NewStyle().
			Foreground(dimColor).
			Padding(1, 0)

	// Info box style
	infoStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(secondaryColor).
			Padding(1, 2).
			Margin(1, 0)
)
