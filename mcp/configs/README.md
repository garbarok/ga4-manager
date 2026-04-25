# GA4 Manager Configuration Files

## Directory Structure

- **configs/** - Your project configuration files
- **configs/examples/** - Example templates and references

## Getting Started

1. Copy a template to create your project config:
   `bash
   cp configs/examples/template.yaml configs/my-project.yaml
   `

2. Edit your config file with your GA4 property details:
   `bash
   vim configs/my-project.yaml
   # Or use any text editor
   `

3. Update the following required fields:
   - `project.name` - Your project name
   - `ga4.property_id` - Your GA4 property ID (find in GA4 Admin)

4. Run the interactive mode to use your config:
   `bash
   ./ga4
   `

## Examples

See `configs/examples/` for complete configuration examples:
- `template.yaml` - Basic template with all options
- `basic-ecommerce.yaml` - E-commerce site example
- `content-site.yaml` - Content/blog site example

## CLI Usage

You can also use configs directly with CLI commands:

```bash
# Setup a project
./ga4 setup --config configs/my-project.yaml

# View reports
./ga4 report --config configs/my-project.yaml

# Export reports
./ga4 report --config configs/my-project.yaml --export json

# Validate configuration
./ga4 validate configs/my-project.yaml
```

## Documentation

For more information:
- Main README: See project root
- Examples README: See configs/examples/README.md
