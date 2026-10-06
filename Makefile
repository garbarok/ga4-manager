.PHONY: build install run clean test lint release

# Binary name
BINARY=ga4
INSTALL_PATH=/usr/local/bin

# Version (can be overridden, e.g., make VERSION=v1.0.0 build)
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")

# Build flags
LDFLAGS=-ldflags "-s -w -X 'github.com/garbarok/ga4-manager/cmd.Version=$(VERSION)'"

# Build the binary
build:
	@echo "Building $(BINARY) $(VERSION)..."
	@go build $(LDFLAGS) -o $(BINARY) .
	@echo "✓ Built $(BINARY) $(VERSION)"

# Install globally
install: build
	@echo "Installing $(BINARY) to $(INSTALL_PATH)..."
	@sudo mv $(BINARY) $(INSTALL_PATH)/$(BINARY)
	@echo "✓ Installed $(BINARY)"
	@echo "  Run with: ga4"

# Run without building
run:
	@go run main.go $(ARGS)

# Clean build artifacts
clean:
	@echo "Cleaning..."
	@rm -f $(BINARY)
	@go clean
	@echo "✓ Cleaned"

# Download dependencies
deps:
	@echo "Downloading dependencies..."
	@go mod download
	@echo "✓ Dependencies downloaded"

# Run tests
test:
	@go test -v ./...

# Run linter
# Pinned so local runs match; v2.14+ is needed for Go 1.27 toolchains.
GOLANGCI_LINT ?= go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.14.0
GORELEASER ?= go run github.com/goreleaser/goreleaser/v2@latest

lint:
	@echo "Running linter..."
	@$(GOLANGCI_LINT) run --timeout=5m
	@echo "✓ Linting passed"

# Release from this machine (no CI). Tag first: git tag -a vX.Y.Z -m "..." && git push origin vX.Y.Z
release: test lint
	@GITHUB_TOKEN=$$(gh auth token) $(GORELEASER) release --clean

# Help
help:
	@echo "GA4 Manager - Makefile targets:"
	@echo ""
	@echo "Build & Install:"
	@echo "  make build          - Build the binary"
	@echo "  make install        - Install globally to $(INSTALL_PATH)"
	@echo "  make clean          - Remove build artifacts"
	@echo ""
	@echo "Development:"
	@echo "  make run ARGS='...' - Run without building"
	@echo "  make deps           - Download dependencies"
	@echo "  make test           - Run tests"
	@echo "  make lint           - Run golangci-lint"
	@echo "  make release        - Test, lint and publish the current tag with GoReleaser"
	@echo ""
	@echo "Usage Examples:"
	@echo "  ./ga4 setup --config configs/my-project.yaml"
	@echo "  ./ga4 report --config configs/my-project.yaml"
	@echo "  ./ga4 cleanup --config configs/my-project.yaml --dry-run"
	@echo "  ./ga4 validate configs/examples/basic-ecommerce.yaml"
