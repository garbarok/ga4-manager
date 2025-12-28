package cmd

import (
	"fmt"
	"log"
	"os"
	"slices"

	"github.com/joho/godotenv"
	"github.com/spf13/cobra"
)

// Version is set via ldflags during build
var Version = "dev"

var rootCmd = &cobra.Command{
	Use:   "ga4",
	Short: "GA4 Manager - Manage your Google Analytics 4 properties",
	Long: `GA4 Manager is a CLI tool to manage your Google Analytics 4 properties.

It helps you automate:
- Setting up conversions
- Creating custom dimensions
- Creating custom metrics
- Managing audiences
- Running quick reports
- Cleaning up unused configurations

Configure your projects using YAML config files.`,
	Run: func(cmd *cobra.Command, args []string) {
		// If no subcommand is provided, launch interactive mode
		RunInteractive()
	},
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func init() {
	rootCmd.Version = Version
	loadEnvironmentConfig()
	validateCredentials()

	// Ensure config directory exists for all commands
	// This is especially important for users who download the binary
	// without cloning the repository
	if err := ensureConfigDirectoryExists(); err != nil {
		// Don't exit here - let commands that need configs handle the error
		// This allows commands like --help and --version to work
		log.Printf("Note: %v\n", err)
	}
}

// loadEnvironmentConfig loads environment from .env if present.
func loadEnvironmentConfig() {
	if err := godotenv.Load(); err != nil {
		if !os.IsNotExist(err) {
			log.Printf("Warning: Error loading .env file: %v\n", err)
		}
	}
}

// validateCredentials ensures credentials are properly configured and not empty
func validateCredentials() {
	credsPath := os.Getenv("GOOGLE_APPLICATION_CREDENTIALS")
	projectID := os.Getenv("GOOGLE_CLOUD_PROJECT")

	// Check if GOOGLE_APPLICATION_CREDENTIALS is set and not empty
	if credsPath == "" {
		fmt.Fprintln(os.Stderr, "⚠️  GOOGLE_APPLICATION_CREDENTIALS not set")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "   To use GA4 Manager, set your Google Cloud credentials:")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "   Option 1: Add to your shell config (recommended)")
		fmt.Fprintln(os.Stderr, "   -------------------------------------------------")
		fmt.Fprintln(os.Stderr, "   # For Bash (~/.bashrc or ~/.bash_profile)")
		fmt.Fprintln(os.Stderr, "   export GOOGLE_APPLICATION_CREDENTIALS=\"/path/to/credentials.json\"")
		fmt.Fprintln(os.Stderr, "   export GOOGLE_CLOUD_PROJECT=\"your-project-id\"")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "   # For Zsh (~/.zshrc)")
		fmt.Fprintln(os.Stderr, "   export GOOGLE_APPLICATION_CREDENTIALS=\"/path/to/credentials.json\"")
		fmt.Fprintln(os.Stderr, "   export GOOGLE_CLOUD_PROJECT=\"your-project-id\"")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "   # For Fish (~/.config/fish/config.fish)")
		fmt.Fprintln(os.Stderr, "   set -gx GOOGLE_APPLICATION_CREDENTIALS /path/to/credentials.json")
		fmt.Fprintln(os.Stderr, "   set -gx GOOGLE_CLOUD_PROJECT your-project-id")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "   Option 2: Set for current session only")
		fmt.Fprintln(os.Stderr, "   ----------------------------------------")
		fmt.Fprintln(os.Stderr, "   export GOOGLE_APPLICATION_CREDENTIALS=\"/path/to/credentials.json\"")
		fmt.Fprintln(os.Stderr, "   ga4 report --config configs/my-project.yaml")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "   📖 Full setup guide: https://github.com/garbarok/ga4-manager#installation")
		return
	}

	// Validate that the credentials path is not a placeholder value
	placeholders := []string{
		"/path/to/your/credentials.json",
		"your-credentials.json",
		"credentials.json",
		"path/to/credentials",
	}
	if slices.Contains(placeholders, credsPath) {
		fmt.Fprintln(os.Stderr, "⚠️  GOOGLE_APPLICATION_CREDENTIALS contains a placeholder value")
		fmt.Fprintf(os.Stderr, "   Found: %s\n", credsPath)
		fmt.Fprintln(os.Stderr, "   Please set the actual path to your credentials file")
		return
	}

	// Check if the credentials file exists
	if _, err := os.Stat(credsPath); os.IsNotExist(err) {
		fmt.Fprintln(os.Stderr, "⚠️  GOOGLE_APPLICATION_CREDENTIALS file does not exist")
		fmt.Fprintf(os.Stderr, "   Path: %s\n", credsPath)
		fmt.Fprintln(os.Stderr, "   Please verify the path to your credentials file")
	}

	// Validate project ID is not a placeholder
	if projectID != "" {
		projectPlaceholders := []string{
			"your-gcp-project-id",
			"your-project-id",
			"project-id",
		}
		if slices.Contains(projectPlaceholders, projectID) {
			fmt.Fprintln(os.Stderr, "⚠️  GOOGLE_CLOUD_PROJECT contains a placeholder value")
			fmt.Fprintf(os.Stderr, "   Found: %s\n", projectID)
			fmt.Fprintln(os.Stderr, "   Please set your actual GCP project ID")
		}
	}
}
