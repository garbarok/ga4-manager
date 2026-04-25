package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/fatih/color"
	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/garbarok/ga4-manager/internal/tui"
	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
)

var validateCmd = &cobra.Command{
	Use:   "validate [config-file]",
	Short: "Validate a GA4 configuration file",
	Long: `Validates the syntax and structure of a GA4 configuration YAML file.
This helps catch YAML indentation errors and configuration issues before deployment.`,
	Example: `  # Validate a specific config file
  ga4 validate configs/examples/basic-ecommerce.yaml

  # Validate all example configs
  ga4 validate --all

  # Validate and show detailed structure
  ga4 validate configs/my-project.yaml --verbose`,
	Args: cobra.MaximumNArgs(1),
	RunE: runValidate,
}

var (
	validateAll     bool
	validateVerbose bool
)

func init() {
	rootCmd.AddCommand(validateCmd)
	validateCmd.Flags().BoolVar(&validateAll, "all", false, "Validate all config files in configs/ directory")
	validateCmd.Flags().BoolVarP(&validateVerbose, "verbose", "v", false, "Show detailed validation results")
}

// runValidate is the Cobra RunE handler — reads flag variables and delegates to executeValidate.
func runValidate(cmd *cobra.Command, args []string) error {
	return executeValidate(validateAll, validateVerbose, args)
}

// executeValidate performs validation with explicit parameters, avoiding reliance on global flag state.
func executeValidate(all, verbose bool, args []string) error {
	green := color.New(color.FgGreen).SprintFunc()
	red := color.New(color.FgRed).SprintFunc()
	yellow := color.New(color.FgYellow).SprintFunc()
	blue := color.New(color.FgBlue).SprintFunc()
	cyan := color.New(color.FgCyan).SprintFunc()

	fmt.Println("🔍 GA4 Config Validator")
	fmt.Println("═══════════════════════════════════════════════")
	fmt.Println()

	var filesToValidate []string

	if all {
		// Find all YAML files in configs/
		paths := []string{"configs/examples", "configs"}
		for _, dir := range paths {
			if entries, err := os.ReadDir(dir); err == nil {
				for _, entry := range entries {
					if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".yaml") {
						filesToValidate = append(filesToValidate, filepath.Join(dir, entry.Name()))
					}
				}
			}
		}

		if len(filesToValidate) == 0 {
			return fmt.Errorf("no YAML config files found in configs/ directory")
		}
	} else if len(args) > 0 {
		filesToValidate = []string{args[0]}
	} else {
		return fmt.Errorf("specify a config file or use --all flag")
	}

	totalFiles := len(filesToValidate)
	validFiles := 0
	invalidFiles := 0

	for _, filePath := range filesToValidate {
		fmt.Printf("📄 Validating: %s\n", cyan(filePath))
		fmt.Println("───────────────────────────────────────────────")

		// Check if file exists
		if _, err := os.Stat(filePath); os.IsNotExist(err) {
			fmt.Printf("%s File not found\n\n", red("✗"))
			invalidFiles++
			continue
		}

		// Read file
		data, err := os.ReadFile(filePath)
		if err != nil {
			fmt.Printf("%s Failed to read file: %v\n\n", red("✗"), err)
			invalidFiles++
			continue
		}

		// Step 1: Validate YAML syntax
		fmt.Printf("%s Checking YAML syntax...", blue("  →"))
		var rawYAML interface{}
		if err := yaml.Unmarshal(data, &rawYAML); err != nil {
			fmt.Printf(" %s\n", red("FAILED"))
			printYAMLError(err, string(data))
			invalidFiles++
			fmt.Println()
			continue
		}
		fmt.Printf(" %s\n", green("OK"))

		// Step 2: Validate config structure
		fmt.Printf("%s Checking config structure...", blue("  →"))
		cfg, err := config.LoadConfig(filePath)
		if err != nil {
			fmt.Printf(" %s\n", red("FAILED"))
			fmt.Printf("    %s\n", err)
			invalidFiles++
			fmt.Println()
			continue
		}
		fmt.Printf(" %s\n", green("OK"))

		// Step 3: Check tier limits
		fmt.Printf("%s Checking tier limits...", blue("  →"))
		warnings := config.ValidateTierLimits(cfg)
		if len(warnings) > 0 {
			fmt.Printf(" %s\n", yellow("WARNINGS"))
			for _, warning := range warnings {
				fmt.Printf("    %s %s\n", yellow("⚠"), warning)
			}
		} else {
			fmt.Printf(" %s\n", green("OK"))
		}

		// Step 4: Show config summary
		if verbose {
			tier := cfg.GA4.Tier
			if tier == "" {
				tier = "standard"
			}
			limits := config.GetTierLimits(tier)

			fmt.Printf("\n%s Configuration Summary:\n", blue("  ℹ"))
			fmt.Printf("    Project: %s\n", cfg.Project.Name)
			fmt.Printf("    Property ID: %s\n", cfg.GA4.PropertyID)
			fmt.Printf("    Tier: %s\n", config.GetTierName(tier))
			fmt.Printf("    Conversions: %d / %d limit\n", len(cfg.Conversions), limits.Conversions)
			fmt.Printf("    Dimensions: %d / %d limit\n", len(cfg.Dimensions), limits.CustomDimensions)
			fmt.Printf("    Metrics: %d / %d limit\n", len(cfg.Metrics), limits.CustomMetrics)
			fmt.Printf("    Calculated Metrics: %d\n", len(cfg.CalculatedMetrics))
			fmt.Printf("    Audiences: %d\n", len(cfg.Audiences))
			if len(cfg.Cleanup.ConversionsToRemove) > 0 || len(cfg.Cleanup.DimensionsToRemove) > 0 {
				fmt.Printf("    Cleanup Items: %d conversions, %d dimensions\n",
					len(cfg.Cleanup.ConversionsToRemove),
					len(cfg.Cleanup.DimensionsToRemove))
			}
			fmt.Println()
		}

		fmt.Printf("%s %s\n\n", green("✓"), green("Valid configuration"))
		validFiles++
	}

	// Summary
	fmt.Println("═══════════════════════════════════════════════")
	fmt.Printf("Validation Results: %d total, %s valid, %s invalid\n",
		totalFiles,
		green(fmt.Sprintf("%d", validFiles)),
		func() string {
			if invalidFiles > 0 {
				return red(fmt.Sprintf("%d", invalidFiles))
			}
			return fmt.Sprintf("%d", invalidFiles)
		}())
	fmt.Println()

	if invalidFiles > 0 {
		fmt.Printf("%s Some files have validation errors\n", yellow("⚠"))
		fmt.Println("\nTips for fixing YAML errors:")
		fmt.Println("  • Use 2 spaces for indentation (not tabs)")
		fmt.Println("  • Ensure consistent indentation throughout")
		fmt.Println("  • Quote values with special characters")
		fmt.Println("  • Use yamllint or a YAML validator in your editor")
		fmt.Println()
		return fmt.Errorf("validation failed")
	}

	fmt.Printf("%s All configuration files are valid!\n", green("✅"))
	fmt.Println()

	return nil
}

// handleValidateAction handles the "Validate Configs" menu action in interactive mode.
func handleValidateAction() {
	projectPath, err := tui.RunProjectSelector()
	if err != nil {
		if err == tui.ErrBackToMenu || err.Error() == "no project selected" {
			return
		}
		fmt.Fprintf(os.Stderr, "Error selecting project: %v\n", err)
		return
	}

	var args []string
	var all bool

	if projectPath == "--all" {
		all = true
		fmt.Println("\n✅ Validating all configurations...")
	} else {
		args = []string{projectPath}
		fmt.Printf("\n✅ Validating %s...\n", projectPath)
	}
	fmt.Println()

	if err := executeValidate(all, false, args); err != nil {
		fmt.Fprintf(os.Stderr, "\n❌ Error running validate: %v\n", err)
	}
}

// printYAMLError provides helpful error messages for YAML syntax errors
func printYAMLError(err error, content string) {
	errStr := err.Error()
	lines := strings.Split(content, "\n")

	// Try to extract line number from error
	var lineNum int
	if _, err := fmt.Sscanf(errStr, "yaml: line %d:", &lineNum); err == nil {
		fmt.Printf("\n    Error at line %d:\n", lineNum)
		if lineNum > 0 && lineNum <= len(lines) {
			// Show context (2 lines before and after)
			start := max(0, lineNum-3)
			end := min(len(lines), lineNum+2)

			for i := start; i < end; i++ {
				prefix := fmt.Sprintf("%4d | ", i+1)
				if i+1 == lineNum {
					fmt.Printf("    → %s%s\n", color.RedString(prefix), lines[i])
				} else {
					fmt.Printf("      %s%s\n", prefix, lines[i])
				}
			}
		}
		fmt.Println()
	}

	fmt.Printf("    Full error: %v\n", err)
	fmt.Println()
	fmt.Println("    Common YAML issues:")
	fmt.Println("    • Mixed tabs and spaces (use 2 spaces for indentation)")
	fmt.Println("    • Missing colon after key")
	fmt.Println("    • Incorrect list syntax (should start with '- ')")
	fmt.Println("    • Unquoted special characters (: { } [ ] , & * # ? | - < > = ! % @)")
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
