package setup

import (
	"fmt"
	"log/slog"
	"strings"
	"sync"

	"github.com/fatih/color"
)

// RollbackOperation represents a single operation that can be rolled back
type RollbackOperation struct {
	Type        string // "conversion", "dimension", "metric", "sitemap"
	ResourceID  string
	PropertyID  string // GA4 property ID or GSC site URL
	Rollback    func() error
	Description string
}

// RollbackManager manages rollback operations for setup failures
type RollbackManager struct {
	operations []RollbackOperation
	logger     *slog.Logger
	mu         sync.Mutex
}

// NewRollbackManager creates a new rollback manager
func NewRollbackManager(logger *slog.Logger) *RollbackManager {
	return &RollbackManager{
		operations: make([]RollbackOperation, 0),
		logger:     logger,
	}
}

// Register registers a rollback operation
func (rm *RollbackManager) Register(op RollbackOperation) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	rm.operations = append(rm.operations, op)
	rm.logger.Debug("registered rollback operation",
		"type", op.Type,
		"resource", op.ResourceID,
		"property", op.PropertyID)
}

// HasOperations returns true if there are any rollback operations registered
func (rm *RollbackManager) HasOperations() bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	return len(rm.operations) > 0
}

// Count returns the number of registered rollback operations
func (rm *RollbackManager) Count() int {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	return len(rm.operations)
}

// GetOperations returns all registered operations
func (rm *RollbackManager) GetOperations() []RollbackOperation {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	return rm.operations
}

// ExecuteAll executes all rollback operations in reverse order (LIFO)
func (rm *RollbackManager) ExecuteAll() error {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	if len(rm.operations) == 0 {
		rm.logger.Debug("no rollback operations to execute")
		return nil
	}

	green := color.New(color.FgGreen).SprintFunc()
	red := color.New(color.FgRed).SprintFunc()
	yellow := color.New(color.FgYellow).SprintFunc()

	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════")
	fmt.Printf("%s Rolling back changes...\n", yellow("⏮️"))
	fmt.Println("───────────────────────────────────────────────")

	successCount := 0
	failCount := 0
	errors := make([]string, 0)

	// Execute in reverse order (last created, first deleted)
	for i := len(rm.operations) - 1; i >= 0; i-- {
		op := rm.operations[i]

		fmt.Printf("  Rolling back %s: %s... ", op.Type, op.ResourceID)

		if err := op.Rollback(); err != nil {
			fmt.Printf("%s\n", red("✗"))
			failCount++
			errors = append(errors, fmt.Sprintf("%s %s: %v", op.Type, op.ResourceID, err))
			rm.logger.Error("rollback failed",
				"type", op.Type,
				"resource", op.ResourceID,
				"error", err)
		} else {
			fmt.Printf("%s\n", green("✓"))
			successCount++
			rm.logger.Debug("rollback successful",
				"type", op.Type,
				"resource", op.ResourceID)
		}
	}

	fmt.Println()
	fmt.Printf("Rollback complete: %s %d succeeded", green("✓"), successCount)
	if failCount > 0 {
		fmt.Printf(", %s %d failed", red("✗"), failCount)
	}
	fmt.Println()

	if len(errors) > 0 {
		fmt.Println()
		fmt.Printf("%s Some rollback operations failed:\n", yellow("⚠️"))
		for _, err := range errors {
			fmt.Printf("  - %s\n", err)
		}
		return fmt.Errorf("%d rollback operations failed", failCount)
	}

	return nil
}

// Clear clears all registered rollback operations
func (rm *RollbackManager) Clear() {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	rm.operations = make([]RollbackOperation, 0)
	rm.logger.Debug("rollback operations cleared")
}

// GenerateSummary returns a summary of registered rollback operations
func (rm *RollbackManager) GenerateSummary() string {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	if len(rm.operations) == 0 {
		return "No rollback operations registered"
	}

	var sb strings.Builder

	// Group by type
	typeCount := make(map[string]int)
	for _, op := range rm.operations {
		typeCount[op.Type]++
	}

	sb.WriteString(fmt.Sprintf("Registered %d rollback operations:\n", len(rm.operations)))
	for typ, count := range typeCount {
		sb.WriteString(fmt.Sprintf("  - %d %s(s)\n", count, typ))
	}

	return sb.String()
}

// PromptForRollback asks the user if they want to rollback changes
func (rm *RollbackManager) PromptForRollback() bool {
	if !rm.HasOperations() {
		return false
	}

	yellow := color.New(color.FgYellow).SprintFunc()
	blue := color.New(color.FgBlue).SprintFunc()

	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════")
	fmt.Printf("%s Setup failed!\n", yellow("⚠️"))
	fmt.Println()
	fmt.Println(rm.GenerateSummary())
	fmt.Println()
	fmt.Printf("%s Do you want to rollback the changes? (y/N): ", blue("?"))

	var response string
	fmt.Scanln(&response)

	response = strings.ToLower(strings.TrimSpace(response))
	return response == "y" || response == "yes"
}
