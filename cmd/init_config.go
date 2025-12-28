package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/fatih/color"
)

// Embedded template configurations
// These will be created automatically on first run
const templateYAML = `# GA4 Manager Configuration Template
# Copy this file to create your project configuration

project:
  name: "My Project"
  description: "Project description"

ga4:
  property_id: "YOUR_PROPERTY_ID"  # Required: Get from GA4 Admin

# Conversion Events
conversions:
  - name: "purchase"
    counting_method: "ONCE_PER_EVENT"
  
  - name: "sign_up"
    counting_method: "ONCE_PER_SESSION"

# Custom Dimensions
dimensions:
  - parameter: "user_type"
    display_name: "User Type"
    scope: "USER"
    description: "Type of user (free, premium, etc.)"
  
  - parameter: "page_category"
    display_name: "Page Category"
    scope: "EVENT"
    description: "Category of the page"

# Custom Metrics
metrics:
  - parameter: "custom_value"
    display_name: "Custom Value"
    scope: "EVENT"
    unit: "STANDARD"
    description: "Custom numeric value"

# Data Retention (optional)
data_retention:
  event_data_retention: "FOURTEEN_MONTHS"
  reset_user_data_on_new_activity: true
`

const basicEcommerceYAML = `# Basic E-commerce Configuration Example

project:
  name: "Basic Ecommerce"
  description: "Standard e-commerce tracking setup"

ga4:
  property_id: "YOUR_PROPERTY_ID"

conversions:
  - name: "purchase"
    counting_method: "ONCE_PER_EVENT"
  
  - name: "add_to_cart"
    counting_method: "ONCE_PER_EVENT"
  
  - name: "begin_checkout"
    counting_method: "ONCE_PER_SESSION"

dimensions:
  - parameter: "user_type"
    display_name: "User Type"
    scope: "USER"
  
  - parameter: "product_category"
    display_name: "Product Category"
    scope: "EVENT"
  
  - parameter: "payment_method"
    display_name: "Payment Method"
    scope: "EVENT"

metrics:
  - parameter: "shipping_cost"
    display_name: "Shipping Cost"
    scope: "EVENT"
    unit: "CURRENCY"
`

const contentSiteYAML = `# Content/Blog Site Configuration Example

project:
  name: "Content Site"
  description: "Content and blog tracking setup"

ga4:
  property_id: "YOUR_PROPERTY_ID"

conversions:
  - name: "subscribe"
    counting_method: "ONCE_PER_SESSION"
  
  - name: "download"
    counting_method: "ONCE_PER_EVENT"
  
  - name: "share"
    counting_method: "ONCE_PER_EVENT"

dimensions:
  - parameter: "content_category"
    display_name: "Content Category"
    scope: "EVENT"
  
  - parameter: "author"
    display_name: "Author"
    scope: "EVENT"
  
  - parameter: "user_type"
    display_name: "User Type"
    scope: "USER"

metrics:
  - parameter: "read_time"
    display_name: "Read Time"
    scope: "EVENT"
    unit: "SECONDS"
`

// ensureConfigDirectoryExists checks if the configs directory exists
// and creates it with example templates if it doesn't
func ensureConfigDirectoryExists() error {
	configsDir := "configs"
	examplesDir := filepath.Join(configsDir, "examples")

	// Check if configs directory exists
	if _, err := os.Stat(configsDir); os.IsNotExist(err) {
		return setupFirstRun(configsDir, examplesDir)
	}

	// Check if examples directory exists
	if _, err := os.Stat(examplesDir); os.IsNotExist(err) {
		return createExamplesDirectory(examplesDir)
	}

	return nil
}

// setupFirstRun creates the initial directory structure and templates
func setupFirstRun(configsDir, examplesDir string) error {
	green := color.New(color.FgGreen).SprintFunc()
	cyan := color.New(color.FgCyan).SprintFunc()
	yellow := color.New(color.FgYellow).SprintFunc()

	fmt.Println()
	fmt.Println(cyan("🎉 Welcome to GA4 Manager!"))
	fmt.Println(strings.Repeat("═", 50))
	fmt.Println()
	fmt.Println(yellow("📁 First-time setup: Creating configuration directories..."))
	fmt.Println()

	// Create directories
	if err := os.MkdirAll(examplesDir, 0755); err != nil {
		return fmt.Errorf("failed to create configs directory: %w", err)
	}

	// Create example templates
	templates := map[string]string{
		"template.yaml":        templateYAML,
		"basic-ecommerce.yaml": basicEcommerceYAML,
		"content-site.yaml":    contentSiteYAML,
	}

	for filename, content := range templates {
		path := filepath.Join(examplesDir, filename)
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			return fmt.Errorf("failed to create %s: %w", filename, err)
		}
		fmt.Printf("  %s Created: %s\n", green("✓"), path)
	}

	// Create README in configs directory
	readmePath := filepath.Join(configsDir, "README.md")
	readmeContent := `# GA4 Manager Configuration Files

## Directory Structure

- **configs/** - Your project configuration files
- **configs/examples/** - Example templates and references

## Getting Started

1. Copy a template to create your project config:
   ` + "`" + `bash
   cp configs/examples/template.yaml configs/my-project.yaml
   ` + "`" + `

2. Edit your config file with your GA4 property details:
   ` + "`" + `bash
   vim configs/my-project.yaml
   # Or use any text editor
   ` + "`" + `

3. Update the following required fields:
   - ` + "`" + `project.name` + "`" + ` - Your project name
   - ` + "`" + `ga4.property_id` + "`" + ` - Your GA4 property ID (find in GA4 Admin)

4. Run the interactive mode to use your config:
   ` + "`" + `bash
   ./ga4
   ` + "`" + `

## Examples

See ` + "`" + `configs/examples/` + "`" + ` for complete configuration examples:
- ` + "`" + `template.yaml` + "`" + ` - Basic template with all options
- ` + "`" + `basic-ecommerce.yaml` + "`" + ` - E-commerce site example
- ` + "`" + `content-site.yaml` + "`" + ` - Content/blog site example

## CLI Usage

You can also use configs directly with CLI commands:

` + "```bash" + `
# Setup a project
./ga4 setup --config configs/my-project.yaml

# View reports
./ga4 report --config configs/my-project.yaml

# Export reports
./ga4 report --config configs/my-project.yaml --export json

# Validate configuration
./ga4 validate configs/my-project.yaml
` + "```" + `

## Documentation

For more information:
- Main README: See project root
- Examples README: See configs/examples/README.md
`

	if err := os.WriteFile(readmePath, []byte(readmeContent), 0644); err != nil {
		return fmt.Errorf("failed to create README: %w", err)
	}
	fmt.Printf("  %s Created: %s\n", green("✓"), readmePath)

	fmt.Println()
	fmt.Println(green("✅ Setup complete!"))
	fmt.Println()
	fmt.Println("📚 Next steps:")
	fmt.Println("  1. Copy a template:")
	fmt.Println("     " + cyan("cp configs/examples/template.yaml configs/my-project.yaml"))
	fmt.Println()
	fmt.Println("  2. Edit your config:")
	fmt.Println("     " + cyan("nano configs/my-project.yaml"))
	fmt.Println("     (or use your preferred editor)")
	fmt.Println()
	fmt.Println("  3. Update your GA4 Property ID in the config file")
	fmt.Println()
	fmt.Println("  4. Run the interactive mode:")
	fmt.Println("     " + cyan("./ga4"))
	fmt.Println()
	fmt.Println(yellow("Press Enter to continue to the main menu..."))
	_, _ = fmt.Scanln()

	return nil
}

// createExamplesDirectory creates just the examples directory with templates
func createExamplesDirectory(examplesDir string) error {
	green := color.New(color.FgGreen).SprintFunc()
	yellow := color.New(color.FgYellow).SprintFunc()

	fmt.Println()
	fmt.Println(yellow("📁 Creating examples directory with templates..."))
	fmt.Println()

	if err := os.MkdirAll(examplesDir, 0755); err != nil {
		return fmt.Errorf("failed to create examples directory: %w", err)
	}

	templates := map[string]string{
		"template.yaml":        templateYAML,
		"basic-ecommerce.yaml": basicEcommerceYAML,
		"content-site.yaml":    contentSiteYAML,
	}

	for filename, content := range templates {
		path := filepath.Join(examplesDir, filename)
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			return fmt.Errorf("failed to create %s: %w", filename, err)
		}
		fmt.Printf("  %s Created: %s\n", green("✓"), path)
	}

	fmt.Println()
	fmt.Println(green("✅ Examples directory created!"))
	fmt.Println()

	return nil
}
