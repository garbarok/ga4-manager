.PHONY: build install run clean test lint

# Binary name
BINARY=ga4
INSTALL_PATH=/usr/local/bin

# Build the binary
build:
	@echo "Building $(BINARY)..."
	@go build -o $(BINARY) .
	@echo "✓ Built $(BINARY)"

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
lint:
	@echo "Running linter..."
	@golangci-lint run
	@echo "✓ Linting passed"

# Setup both projects
setup-all: build
	@./$(BINARY) setup --all

# Setup SnapCompress only
setup-snap: build
	@./$(BINARY) setup --project snapcompress

# Setup Personal Website only
setup-personal: build
	@./$(BINARY) setup --project personal

# Show reports
report-snap: build
	@./$(BINARY) report --project snapcompress

report-personal: build
	@./$(BINARY) report --project personal

# Help
help:
	@echo "GA4 Manager - Makefile targets:"
	@echo "  make build          - Build the binary"
	@echo "  make install        - Install globally to $(INSTALL_PATH)"
	@echo "  make run ARGS='...' - Run without building"
	@echo "  make clean          - Remove build artifacts"
	@echo "  make deps           - Download dependencies"
	@echo "  make test           - Run tests"
	@echo "  make lint           - Run golangci-lint"
	@echo ""
	@echo "Quick commands:"
	@echo "  make setup-all      - Setup all projects"
	@echo "  make setup-snap     - Setup SnapCompress only"
	@echo "  make setup-personal - Setup Personal Website only"
	@echo "  make report-snap    - Show SnapCompress report"
	@echo "  make report-personal- Show Personal Website report"
