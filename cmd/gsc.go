package cmd

import (
	"fmt"
	"os"

	"github.com/fatih/color"
	"github.com/spf13/cobra"
)

var gscCmd = &cobra.Command{
	Use:   "gsc",
	Short: "Google Search Console operations",
	Long: `Manage your Google Search Console properties.

Available operations:
- Submit and manage sitemaps
- Inspect URLs for indexing status
- Generate search analytics reports

Requires a verified site in Google Search Console and proper authentication.`,
	PersistentPreRun: func(cmd *cobra.Command, args []string) {
		// Check for credentials
		if os.Getenv("GOOGLE_APPLICATION_CREDENTIALS") == "" {
			color.Red("✗ GOOGLE_APPLICATION_CREDENTIALS environment variable not set")
			fmt.Println("\nPlease set the path to your service account credentials:")
			fmt.Println("  export GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json")
			fmt.Println("\nOr add it to your .env file:")
			fmt.Println("  GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json")
			os.Exit(1)
		}
	},
}

func init() {
	rootCmd.AddCommand(gscCmd)
}
