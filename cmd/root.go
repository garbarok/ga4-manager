package cmd

import (
	"fmt"
	"os"

	"github.com/joho/godotenv"
	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "ga4",
	Short: "GA4 Manager - Manage your Google Analytics 4 properties",
	Long: `GA4 Manager is a CLI tool to manage your Google Analytics 4 properties.
	
It helps you automate:
- Setting up conversions
- Creating custom dimensions
- Managing audiences
- Running quick reports

Designed specifically for SnapCompress and Personal Website projects.`,
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func init() {
	// Load .env file if it exists
	_ = godotenv.Load()

	// Check for required environment variables
	if os.Getenv("GOOGLE_APPLICATION_CREDENTIALS") == "" {
		fmt.Fprintln(os.Stderr, "⚠️  GOOGLE_APPLICATION_CREDENTIALS not set")
		fmt.Fprintln(os.Stderr, "   Please set it in your .env file or environment")
	}
}
