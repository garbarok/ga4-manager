package setup

import (
	"errors"
	"fmt"
	"log/slog"

	"github.com/fatih/color"
	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/garbarok/ga4-manager/internal/ga4"
	"github.com/garbarok/ga4-manager/internal/gsc"
)

// SetupOrchestrator coordinates the entire setup process
type SetupOrchestrator struct {
	config     *config.ProjectConfig
	configPath string
	ga4Client  *ga4.Client
	gscClient  *gsc.Client
	validator  *PreflightValidator
	progress   *ProgressTracker
	rollback   *RollbackManager
	logger     *slog.Logger
	dryRun     bool
}

// NewSetupOrchestrator creates a new setup orchestrator
func NewSetupOrchestrator(
	cfg *config.ProjectConfig,
	configPath string,
	ga4Client *ga4.Client,
	gscClient *gsc.Client,
	logger *slog.Logger,
	dryRun bool,
) *SetupOrchestrator {
	validator := NewPreflightValidator(cfg, ga4Client, gscClient, logger)
	progress := NewProgressTracker()
	rollbackMgr := NewRollbackManager(logger)

	return &SetupOrchestrator{
		config:     cfg,
		configPath: configPath,
		ga4Client:  ga4Client,
		gscClient:  gscClient,
		validator:  validator,
		progress:   progress,
		rollback:   rollbackMgr,
		logger:     logger,
		dryRun:     dryRun,
	}
}

// Execute runs the entire setup process
func (so *SetupOrchestrator) Execute() error {
	blue := color.New(color.FgBlue).SprintFunc()

	// Print header
	fmt.Println()
	fmt.Println("🚀 GA4 Manager - Unified Setup")
	fmt.Println("═══════════════════════════════════════════════")
	fmt.Println()

	if so.dryRun {
		fmt.Printf("%s Dry-run mode enabled - no changes will be applied\n\n", blue("ℹ️"))
	}

	// Step 1: Pre-flight validation
	if err := so.RunPreflight(); err != nil {
		return err
	}

	// Step 2: Add setup steps to tracker
	if so.config.HasAnalytics() {
		so.progress.AddStep("GA4 Setup", "Configure Google Analytics 4 property")
	}
	if so.config.HasSearchConsole() {
		so.progress.AddStep("GSC Setup", "Configure Google Search Console property")
	}

	// Step 3: Execute GA4 setup
	if so.config.HasAnalytics() {
		so.progress.StartStep("GA4 Setup")
		if err := so.SetupGA4(); err != nil {
			so.progress.FailStep("GA4 Setup", err)
			return so.handleError("GA4 setup failed", err)
		}
		so.progress.CompleteStep("GA4 Setup", fmt.Sprintf("%d conversions, %d dimensions, %d metrics",
			len(so.config.Conversions), len(so.config.Dimensions), len(so.config.Metrics)))
	}

	// Step 4: Execute GSC setup
	if so.config.HasSearchConsole() {
		so.progress.StartStep("GSC Setup")
		if err := so.SetupGSC(); err != nil {
			so.progress.FailStep("GSC Setup", err)
			return so.handleError("GSC setup failed", err)
		}

		sitemapCount := len(so.config.SearchConsole.Sitemaps)
		so.progress.CompleteStep("GSC Setup", fmt.Sprintf("%d sitemaps submitted", sitemapCount))
	}

	// Step 5: Finish and display summary
	so.progress.Finish()

	fmt.Println()
	fmt.Println(so.progress.GenerateSummary())

	if !so.dryRun {
		so.printNextSteps()
	} else {
		fmt.Println()
		fmt.Printf("%s Dry-run complete! No changes were applied.\n", blue("ℹ️"))
		fmt.Println()
		fmt.Println("Run without --dry-run to apply changes:")
		fmt.Printf("  ./ga4 setup --config %s\n", so.configPath)
		fmt.Println()
	}

	return nil
}

// RunPreflight executes pre-flight validation
func (so *SetupOrchestrator) RunPreflight() error {
	green := color.New(color.FgGreen).SprintFunc()
	yellow := color.New(color.FgYellow).SprintFunc()
	red := color.New(color.FgRed).SprintFunc()
	blue := color.New(color.FgBlue).SprintFunc()
	gray := color.New(color.FgHiBlack).SprintFunc()

	fmt.Printf("%s Pre-flight Validation\n", blue("📋"))
	fmt.Println("───────────────────────────────────────────────")

	// Run all validation checks
	results, err := so.validator.ValidateAll()

	// Display results
	for _, result := range results {
		var statusIcon string
		switch result.Status {
		case ValidationPassed:
			statusIcon = green("✓")
		case ValidationWarning:
			statusIcon = yellow("⚠️")
		case ValidationFailed:
			statusIcon = red("✗")
		case ValidationSkipped:
			statusIcon = gray("○")
		}

		fmt.Printf("  %s %s", statusIcon, result.Name)
		if result.Details != "" {
			fmt.Printf(" %s", gray(fmt.Sprintf("(%s)", result.Details)))
		}
		fmt.Println()

		if result.Warning != "" {
			fmt.Printf("    %s %s\n", yellow("⚠️"), result.Warning)
		}

		if result.Error != nil {
			fmt.Printf("    %s %s\n", red("Error:"), result.Error.Error())
			if result.Details != "" {
				fmt.Printf("    %s\n", gray(result.Details))
			}
		}
	}

	if err != nil {
		fmt.Println()
		return fmt.Errorf("pre-flight validation failed: %w", err)
	}

	// Detect conflicts
	fmt.Println()
	conflicts, err := so.validator.DetectConflicts()
	if err != nil {
		return fmt.Errorf("conflict detection failed: %w", err)
	}

	if len(conflicts) > 0 {
		fmt.Printf("%s Detected existing resources (will skip):\n", yellow("⚠️"))
		for _, conflict := range conflicts {
			fmt.Printf("  %s %s: %s\n", gray("○"), conflict.ResourceType, conflict.ResourceName)
		}
	}

	fmt.Println()
	return nil
}

// SetupGA4 configures Google Analytics 4
func (so *SetupOrchestrator) SetupGA4() error {
	if so.ga4Client == nil {
		so.logger.Warn("GA4 client is nil, skipping GA4 setup")
		return nil
	}

	green := color.New(color.FgGreen).SprintFunc()
	blue := color.New(color.FgBlue).SprintFunc()
	red := color.New(color.FgRed).SprintFunc()
	yellow := color.New(color.FgYellow).SprintFunc()

	propertyID := so.config.GetPropertyID()

	fmt.Println()
	fmt.Printf("[1/2] %s Google Analytics 4 Setup\n", blue("📊"))
	fmt.Println("───────────────────────────────────────────────")

	// Get existing resources to detect duplicates
	existingConversions, err := so.ga4Client.ListConversions(propertyID)
	if err != nil {
		so.logger.Warn("failed to list existing conversions", "error", err)
	}
	conversionMap := make(map[string]bool)
	for _, conv := range existingConversions {
		conversionMap[conv.EventName] = true
	}

	existingDimensions, err := so.ga4Client.ListDimensions(propertyID)
	if err != nil {
		so.logger.Warn("failed to list existing dimensions", "error", err)
	}
	dimensionMap := make(map[string]bool)
	for _, dim := range existingDimensions {
		dimensionMap[dim.ParameterName] = true
	}

	existingMetrics, err := so.ga4Client.ListCustomMetrics(propertyID)
	if err != nil {
		so.logger.Warn("failed to list existing metrics", "error", err)
	}
	metricMap := make(map[string]bool)
	for _, metric := range existingMetrics {
		metricMap[metric.ParameterName] = true
	}

	// Setup conversions
	fmt.Printf("\n%s Creating conversions...\n", "🎯")
	createdCount := 0
	skippedCount := 0

	for _, conv := range so.config.Conversions {
		if conversionMap[conv.Name] {
			fmt.Printf("  %s %s %s\n", yellow("○"), conv.Name, blue("(already exists, skipping)"))
			skippedCount++
			continue
		}

		if so.dryRun {
			fmt.Printf("  %s %s (counting: %s)\n", blue("○"), conv.Name, conv.CountingMethod)
			createdCount++
		} else {
			err := so.ga4Client.CreateConversion(propertyID, conv.Name, conv.CountingMethod)
			if errors.Is(err, ga4.ErrAlreadyExists) {
				fmt.Printf("  %s %s %s\n", yellow("○"), conv.Name, blue("(conflict: already exists, skipping)"))
				skippedCount++
				continue
			}
			if err != nil {
				fmt.Printf("  %s %s: %s\n", red("✗"), conv.Name, err)
				return fmt.Errorf("create conversion %s: %w", conv.Name, err)
			}

			// Register rollback
			convName := conv.Name
			so.rollback.Register(RollbackOperation{
				Type:        "conversion",
				ResourceID:  convName,
				PropertyID:  propertyID,
				Description: fmt.Sprintf("Delete conversion: %s", convName),
				Rollback: func() error {
					return so.ga4Client.DeleteConversion(propertyID, convName)
				},
			})

			fmt.Printf("  %s %s\n", green("✓"), conv.Name)
			createdCount++
		}
	}

	if createdCount > 0 || skippedCount > 0 {
		fmt.Printf("  Created: %d, Skipped: %d\n", createdCount, skippedCount)
	}

	// Setup dimensions
	fmt.Printf("\n%s Creating custom dimensions...\n", "📊")
	createdCount = 0
	skippedCount = 0

	for _, dim := range so.config.Dimensions {
		if dimensionMap[dim.ParameterName] {
			fmt.Printf("  %s %s %s\n", yellow("○"), dim.DisplayName, blue("(already exists, skipping)"))
			skippedCount++
			continue
		}

		if so.dryRun {
			fmt.Printf("  %s %s (param: %s, scope: %s)\n", blue("○"), dim.DisplayName, dim.ParameterName, dim.Scope)
			createdCount++
		} else {
			err := so.ga4Client.CreateDimension(propertyID, dim)
			if errors.Is(err, ga4.ErrAlreadyExists) {
				fmt.Printf("  %s %s %s\n", yellow("○"), dim.DisplayName, blue("(conflict: already exists, skipping)"))
				skippedCount++
				continue
			}
			if err != nil {
				fmt.Printf("  %s %s: %s\n", red("✗"), dim.DisplayName, err)
				return fmt.Errorf("create dimension %s: %w", dim.DisplayName, err)
			}

			// Note: We don't register rollback for dimensions because archiving them
			// doesn't free up the parameter name (GA4 limitation)

			fmt.Printf("  %s %s\n", green("✓"), dim.DisplayName)
			createdCount++
		}
	}

	if createdCount > 0 || skippedCount > 0 {
		fmt.Printf("  Created: %d, Skipped: %d\n", createdCount, skippedCount)
	}

	// Setup metrics
	fmt.Printf("\n%s Creating custom metrics...\n", "📈")
	createdCount = 0
	skippedCount = 0

	for _, metric := range so.config.Metrics {
		if metricMap[metric.ParameterName] {
			fmt.Printf("  %s %s %s\n", yellow("○"), metric.DisplayName, blue("(already exists, skipping)"))
			skippedCount++
			continue
		}

		if so.dryRun {
			fmt.Printf("  %s %s (param: %s, scope: %s, unit: %s)\n",
				blue("○"), metric.DisplayName, metric.ParameterName, metric.Scope, metric.MeasurementUnit)
			createdCount++
		} else {
			err := so.ga4Client.CreateCustomMetric(propertyID, metric)
			if errors.Is(err, ga4.ErrAlreadyExists) {
				fmt.Printf("  %s %s %s\n", yellow("○"), metric.DisplayName, blue("(conflict: already exists, skipping)"))
				skippedCount++
				continue
			}
			if err != nil {
				fmt.Printf("  %s %s: %s\n", red("✗"), metric.DisplayName, err)
				return fmt.Errorf("create metric %s: %w", metric.DisplayName, err)
			}

			fmt.Printf("  %s %s\n", green("✓"), metric.DisplayName)
			createdCount++
		}
	}

	if createdCount > 0 || skippedCount > 0 {
		fmt.Printf("  Created: %d, Skipped: %d\n", createdCount, skippedCount)
	}

	// Show guidance for manual tasks
	if len(so.config.Audiences) > 0 {
		fmt.Printf("\n%s Audiences (manual setup required):\n", yellow("👥"))
		for _, aud := range so.config.Audiences {
			fmt.Printf("  %s %s\n", yellow("○"), aud.Name)
		}
		fmt.Printf("  %s Audiences must be created manually in GA4 UI\n", blue("ℹ️"))
	}

	return nil
}

// SetupGSC configures Google Search Console
func (so *SetupOrchestrator) SetupGSC() error {
	if so.gscClient == nil {
		so.logger.Warn("GSC client is nil, skipping GSC setup")
		return nil
	}

	green := color.New(color.FgGreen).SprintFunc()
	blue := color.New(color.FgBlue).SprintFunc()
	red := color.New(color.FgRed).SprintFunc()
	yellow := color.New(color.FgYellow).SprintFunc()

	gsc := so.config.SearchConsole
	siteURL := gsc.SiteURL

	fmt.Println()
	fmt.Printf("[2/2] %s Google Search Console Setup\n", blue("🔍"))
	fmt.Println("───────────────────────────────────────────────")

	// Get existing sitemaps to detect duplicates
	existingSitemaps, _ := so.gscClient.ListSitemaps(siteURL)
	sitemapMap := make(map[string]bool)
	for _, sitemap := range existingSitemaps {
		sitemapMap[sitemap.Path] = true
	}

	// Submit sitemaps
	if len(gsc.Sitemaps) > 0 {
		fmt.Printf("\n%s Submitting sitemaps...\n", "🗺️")

		submittedCount := 0
		skippedCount := 0

		for _, sitemap := range gsc.Sitemaps {
			if !sitemap.AutoSubmit {
				fmt.Printf("  %s %s %s\n", yellow("○"), sitemap.URL, blue("(auto_submit: false, skipping)"))
				continue
			}

			if sitemapMap[sitemap.URL] {
				fmt.Printf("  %s %s %s\n", yellow("○"), sitemap.URL, blue("(already submitted, skipping)"))
				skippedCount++
				continue
			}

			if so.dryRun {
				fmt.Printf("  %s %s\n", blue("○"), sitemap.URL)
				submittedCount++
			} else {
				err := so.gscClient.SubmitSitemap(siteURL, sitemap.URL)
				if err != nil {
					fmt.Printf("  %s %s: %s\n", red("✗"), sitemap.URL, err)
					return fmt.Errorf("submit sitemap %s: %w", sitemap.URL, err)
				}

				// Register rollback
				sitemapURL := sitemap.URL
				so.rollback.Register(RollbackOperation{
					Type:        "sitemap",
					ResourceID:  sitemapURL,
					PropertyID:  siteURL,
					Description: fmt.Sprintf("Delete sitemap: %s", sitemapURL),
					Rollback: func() error {
						return so.gscClient.DeleteSitemap(siteURL, sitemapURL)
					},
				})

				fmt.Printf("  %s %s\n", green("✓"), sitemap.URL)
				submittedCount++
			}
		}

		if submittedCount > 0 || skippedCount > 0 {
			fmt.Printf("  Submitted: %d, Skipped: %d\n", submittedCount, skippedCount)
		}
	}

	// Show URL monitoring configuration
	if gsc.URLInspection != nil && len(gsc.URLInspection.PriorityURLs) > 0 {
		fmt.Printf("\n%s URL Monitoring configured\n", "🔍")
		fmt.Printf("  Priority URLs: %d\n", len(gsc.URLInspection.PriorityURLs))
		if !so.dryRun {
			fmt.Printf("  Run: ./ga4 gsc monitor run --config %s\n", so.configPath)
		}
	}

	// Show search analytics configuration
	if gsc.SearchAnalytics != nil {
		fmt.Printf("\n%s Search Analytics configured\n", "📊")
		if gsc.SearchAnalytics.DateRange != nil {
			fmt.Printf("  Date range: Last %d days\n", gsc.SearchAnalytics.DateRange.Days)
		}
		if len(gsc.SearchAnalytics.Dimensions) > 0 {
			fmt.Printf("  Dimensions: %v\n", gsc.SearchAnalytics.Dimensions)
		}
		if !so.dryRun {
			fmt.Printf("  Run: ./ga4 gsc analytics run --config %s\n", so.configPath)
		}
	}

	return nil
}

// handleError handles setup errors with optional rollback
func (so *SetupOrchestrator) handleError(message string, err error) error {
	if so.dryRun {
		return fmt.Errorf("%s: %w", message, err)
	}

	// If we have rollback operations and user wants to rollback
	if so.rollback.HasOperations() && so.rollback.PromptForRollback() {
		if rollbackErr := so.rollback.ExecuteAll(); rollbackErr != nil {
			so.logger.Error("rollback failed", "error", rollbackErr)
		}
	}

	return fmt.Errorf("%s: %w", message, err)
}

// printNextSteps prints next steps after successful setup
func (so *SetupOrchestrator) printNextSteps() {
	blue := color.New(color.FgBlue).SprintFunc()

	fmt.Println()
	fmt.Println("Next steps:")

	stepNum := 1

	if so.config.HasAnalytics() {
		fmt.Printf("%d. Verify GA4 setup: https://analytics.google.com\n", stepNum)
		stepNum++
	}

	if so.config.HasSearchConsole() {
		if so.config.SearchConsole.URLInspection != nil && len(so.config.SearchConsole.URLInspection.PriorityURLs) > 0 {
			fmt.Printf("%d. Run URL monitoring: %s\n", stepNum, blue(fmt.Sprintf("./ga4 gsc monitor run --config %s", so.configPath)))
			stepNum++
		}

		if so.config.SearchConsole.SearchAnalytics != nil {
			fmt.Printf("%d. Check search analytics: %s\n", stepNum, blue(fmt.Sprintf("./ga4 gsc analytics run --config %s", so.configPath)))
			stepNum++
		}
	}

	if so.config.HasAnalytics() {
		fmt.Printf("%d. Implement event tracking in your app\n", stepNum)
		stepNum++
		fmt.Printf("%d. Test events in GA4 DebugView\n", stepNum)
	}

	fmt.Println()
}
