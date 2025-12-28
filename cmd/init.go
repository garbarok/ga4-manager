package cmd

import (
	"context"
	"fmt"
	"os"

	"github.com/fatih/color"
	"github.com/garbarok/ga4-manager/internal/tui"
	"github.com/spf13/cobra"
	"google.golang.org/api/analyticsadmin/v1alpha"
	"google.golang.org/api/option"
)

var initCmd = &cobra.Command{
	Use:   "init",
	Short: "Interactive setup wizard for credentials",
	Long: `Launch an interactive wizard to configure Google Cloud credentials.

This wizard will:
  1. Prompt for your service account credentials path
  2. Prompt for your GCP project ID
  3. Optionally save to .env file
  4. Test the credentials
  5. Provide shell-specific export instructions`,
	Run: func(cmd *cobra.Command, args []string) {
		runInitWizard()
	},
}

func init() {
	rootCmd.AddCommand(initCmd)
}

func runInitWizard() {
	// Run the setup wizard
	config, err := tui.RunSetupWizard()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error running setup wizard: %v\n", err)
		os.Exit(1)
	}

	// Save to .env if requested
	if config.SaveToEnv {
		fmt.Println("\n💾 Saving configuration to .env file...")
		if err := tui.SaveToEnvFile(config); err != nil {
			color.Red("✗ Failed to save .env file: %v", err)
			os.Exit(1)
		}
		color.Green("✓ Configuration saved to .env")
	}

	// Test credentials
	fmt.Println("\n🔍 Testing credentials...")
	if err := testCredentials(config); err != nil {
		color.Red("✗ Credential test failed: %v", err)
		fmt.Println("\nPlease verify:")
		fmt.Println("  1. The credentials file exists and is valid JSON")
		fmt.Println("  2. The service account has the required permissions:")
		fmt.Println("     - Analytics Admin API access")
		fmt.Println("     - roles/analytics.admin or similar")
		fmt.Println("\nFor help, see: https://github.com/garbarok/ga4-manager#installation")
		os.Exit(1)
	}
	color.Green("✓ Credentials are valid!")

	// Print shell instructions
	tui.PrintShellInstructions(config)

	// Success message
	successStyle := color.New(color.FgGreen, color.Bold)
	fmt.Println()
	_, _ = successStyle.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	_, _ = successStyle.Println("🎉 Setup Complete!")
	_, _ = successStyle.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	fmt.Println()
}

// testCredentials tests the credentials by attempting to create an Analytics Admin client
func testCredentials(config *tui.CredentialConfig) error {
	ctx := context.Background()

	// Set environment variables temporarily for testing
	originalCreds := os.Getenv("GOOGLE_APPLICATION_CREDENTIALS")
	originalProject := os.Getenv("GOOGLE_CLOUD_PROJECT")

	// Expand ~ if present
	credPath := config.CredentialsPath
	if credPath[0] == '~' {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return fmt.Errorf("could not expand home directory: %w", err)
		}
		credPath = homeDir + credPath[1:]
	}

	_ = os.Setenv("GOOGLE_APPLICATION_CREDENTIALS", credPath)
	if config.ProjectID != "" {
		_ = os.Setenv("GOOGLE_CLOUD_PROJECT", config.ProjectID)
	}

	// Restore original values after testing
	defer func() {
		_ = os.Setenv("GOOGLE_APPLICATION_CREDENTIALS", originalCreds)
		_ = os.Setenv("GOOGLE_CLOUD_PROJECT", originalProject)
	}()

	// Try to create Analytics Admin client
	//nolint:staticcheck // We accept credentials from trusted user input
	client, err := analyticsadmin.NewService(ctx, option.WithCredentialsFile(credPath))
	if err != nil {
		return fmt.Errorf("failed to create Analytics Admin client: %w", err)
	}

	// Test by listing account summaries (lightweight API call)
	_, err = client.AccountSummaries.List().PageSize(1).Do()
	if err != nil {
		return fmt.Errorf("failed to access Analytics Admin API: %w", err)
	}

	return nil
}
