#!/bin/bash
# Format and validate YAML config files

set -e

echo "🔍 GA4 Config YAML Formatter"
echo "════════════════════════════════════════════════"
echo ""

# Check if yamllint is installed
if ! command -v yamllint &> /dev/null; then
    echo "⚠️  yamllint not found"
    echo ""
    echo "To install yamllint:"
    echo "  • Python/pip:  pip install yamllint"
    echo "  • Homebrew:    brew install yamllint"
    echo "  • apt:         sudo apt-get install yamllint"
    echo ""
    read -p "Continue without yamllint? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
    SKIP_LINT=true
fi

# Check if yq is installed (for formatting)
if ! command -v yq &> /dev/null; then
    echo "⚠️  yq not found (optional, for auto-formatting)"
    echo ""
    echo "To install yq:"
    echo "  • Homebrew:    brew install yq"
    echo "  • Go:          go install github.com/mikefarah/yq/v4@latest"
    echo ""
    SKIP_FORMAT=true
fi

echo ""
echo "📄 Processing config files..."
echo ""

# Find all YAML files
YAML_FILES=$(find configs -name "*.yaml" -o -name "*.yml")

for file in $YAML_FILES; do
    echo "Processing: $file"

    # Format with yq (if available)
    if [ -z "$SKIP_FORMAT" ]; then
        echo "  → Formatting..."
        yq eval -i '.' "$file" 2>/dev/null || echo "    ⚠️ Could not format (syntax error?)"
    fi

    # Lint with yamllint (if available)
    if [ -z "$SKIP_LINT" ]; then
        echo "  → Linting..."
        if yamllint -c .yamllint.yaml "$file"; then
            echo "    ✓ Valid"
        else
            echo "    ✗ Has issues"
        fi
    fi

    echo ""
done

echo "════════════════════════════════════════════════"
echo "✅ Done!"
echo ""
echo "Next steps:"
echo "  • Run: ./ga4 validate --all"
echo "  • Or:  ./ga4 validate configs/my-project.yaml"
echo ""
