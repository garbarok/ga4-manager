# GA4 Manager CLI

A comprehensive CLI tool for managing Google Analytics 4 properties with advanced SEO tracking, custom metrics, and external service integrations. Specifically designed for SnapCompress and Personal Website projects.

## ✨ Features

- 🎯 **Automated conversion events setup** - Create and manage GA4 conversion events
- 📊 **Custom dimensions management** - Configure custom dimensions with proper scopes
- 📈 **Custom metrics creation** - Define and deploy custom metrics
- 🧮 **Calculated metrics** - Create calculated metrics with formula expressions
- 👥 **Enhanced audience definitions** - Comprehensive audience documentation (17+ per project)
- 🔗 **External service integration** - Search Console, BigQuery, Channel Groups
- 📡 **Channel grouping configuration** - Custom channel attribution (9 default groups)
- 🌐 **Core Web Vitals tracking** - Full CWV dimension setup
- 📋 **Quick configuration reports** - Beautiful table-formatted reports
- 🔍 **Data stream management** - Enhanced measurement configuration
- 💾 **Data retention settings** - Configure retention policies
- ✅ **Linting & Code Quality** - Built-in code quality checks
- 🚀 **Simple and fast** - Intuitive CLI with colored output

## 🚀 Quick Start

```bash
# Clone and build
git clone https://github.com/garbarok/ga4-manager.git
cd ga4-manager
make build

# Setup all projects
./ga4 setup --all

# View configuration
./ga4 report --project snapcompress
```

## 📦 Installation

### Build from source

```bash
# Clone repository
git clone https://github.com/garbarok/ga4-manager.git
cd ga4-manager

# Download dependencies
go mod download

# Build binary
go build -o ga4 .

# Or use make
make build

# Install globally (optional)
sudo make install
```

### Development setup

```bash
# Install linter
brew install golangci-lint

# Run tests
make test

# Run linter
make lint
```

## ⚙️ Prerequisites

### 1. Google Cloud Setup

1. Create a Google Cloud Project
2. Enable the Google Analytics Admin API
3. Create a service account with appropriate permissions
4. Download the service account JSON key

### 2. Environment Configuration

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/credentials.json
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
```

### 3. Required OAuth Scopes

- `https://www.googleapis.com/auth/analytics.edit`
- `https://www.googleapis.com/auth/analytics.readonly`

## 📖 Usage

### Setup Commands

```bash
# Setup all projects
./ga4 setup --all

# Setup specific project
./ga4 setup --project snapcompress
./ga4 setup --project personal
./ga4 setup -p snap  # Short form

# Using make
make setup-all
make setup-snap
make setup-personal
```

### Report Commands

```bash
# View SnapCompress configuration
./ga4 report
./ga4 report --project snapcompress

# View Personal Website configuration
./ga4 report --project personal

# Using make
make report-snap
make report-personal
```

### Link Commands

```bash
# List all existing links
./ga4 link --project snapcompress --list

# Search Console (generates manual setup guide)
./ga4 link --project snapcompress \
  --service search-console \
  --url https://snapcompress.com

# BigQuery Export (generates manual setup guide)
./ga4 link --project snapcompress \
  --service bigquery \
  --gcp-project my-gcp-project \
  --dataset analytics_snapcompress

# Channel Groups (automated setup)
./ga4 link --project snapcompress --service channels

# Unlink service (where supported)
./ga4 link --project snapcompress --unlink channels
```

### Help Commands

```bash
./ga4 --help           # Main help
./ga4 setup --help     # Setup command help
./ga4 report --help    # Report command help
./ga4 link --help      # Link command help
```

## 🎯 What It Automates

### SnapCompress Analytics

**Conversions** (27 events):
- Core: `download_image`, `compression_complete`, `format_conversion`, `blog_engagement`
- SEO: `search_impression`, `organic_visit`, `core_web_vitals_fail`, `social_share`
- Technical: `404_error`, `redirect_followed`, `resource_load_error`, `javascript_error`
- Engagement: `scroll_depth_25/50/75/100`, `exit_intent`, `rage_click`, `session_extended`

**Custom Dimensions** (30+):
- User behavior: User Type, Compression Quality, File Format, Compression Ratio
- Core Web Vitals: LCP, FID, CLS, INP, TTFB scores
- SEO: Search Query, Position, Organic Source, Landing Page Type
- Technical: Page Load Time, DOM Load Time, Server Response Time

**Custom Metrics** (5):
- Compressed Size KB, Processing Time MS, Reduction Percent, Original Size KB, Time Spent MS

**Calculated Metrics** (6):
- Conversion Rate, Avg Session Duration, Engagement Rate, Bounce Rate, Pages/Session, Revenue/User

**Audiences** (17):
- SEO-focused, Conversion optimization, Behavioral segmentation

### Personal Website Analytics

**Conversions** (25 events):
- Core: `newsletter_subscribe`, `contact_form_submit`, `demo_click`, `github_click`
- Content: `article_read`, `code_copy`, `article_share_linkedin`, `article_share_twitter`
- SEO: `search_impression`, `organic_article_visit`, `backlink_click`, `internal_search`
- Technical: `core_web_vitals_pass`, `page_speed_good`, `404_error`

**Custom Dimensions** (30+):
- Content: Article Category, Language, Word Count, Reading Completion
- Core Web Vitals: LCP, FID, CLS, INP, TTFB scores
- SEO: Search Query, Position, Organic Source, UTM parameters
- Engagement: Session Quality Score, Engagement Level, Scroll Depth

**Custom Metrics** (5):
- Article Read Time, Shares Count, Engagement Score, Code Copies, Form Submissions

**Audiences** (17):
- Content consumers, Technical readers, Newsletter prospects, Career interested

### Channel Groups (9 default groups)

1. **Organic Search** - Google, Bing, DuckDuckGo
2. **Paid Search** - Google Ads, Bing Ads
3. **Organic Social** - Facebook, Twitter, LinkedIn, Reddit
4. **Paid Social** - Facebook Ads, LinkedIn Ads
5. **Direct** - Direct traffic
6. **Referral** - Referral traffic
7. **Email** - Email campaigns
8. **Affiliates** - Affiliate programs
9. **Display** - Display advertising

## 🔧 Development

### Build Commands

```bash
make build          # Build binary
make install        # Install globally
make clean          # Remove artifacts
make deps           # Download dependencies
```

### Testing & Quality

```bash
make test           # Run all tests
make lint           # Run golangci-lint
go test -v ./...    # Verbose test output
golangci-lint run   # Direct linter execution
```

### Running without building

```bash
go run main.go setup --all
make run ARGS='setup --all'
```

## 📁 Project Structure

```
ga4-manager/
├── cmd/                          # CLI commands
│   ├── root.go                   # Root command & initialization
│   ├── setup.go                  # Setup conversions, dimensions, metrics
│   ├── report.go                 # Configuration reports
│   └── link.go                   # External service integration
├── internal/
│   ├── config/                   # Project configurations
│   │   ├── projects.go           # SnapCompress & Personal Website configs
│   │   ├── metrics.go            # Custom metrics definitions
│   │   └── audiences.go          # Audience definitions
│   ├── ga4/                      # GA4 API client wrapper
│   │   ├── client.go             # API initialization
│   │   ├── conversions.go        # Conversion events management
│   │   ├── dimensions.go         # Custom dimensions
│   │   ├── metrics.go            # Custom metrics
│   │   ├── calculated.go         # Calculated metrics
│   │   ├── audiences.go          # Audience documentation
│   │   ├── datastreams.go        # Data stream configuration
│   │   ├── retention.go          # Data retention settings
│   │   ├── searchconsole.go      # Search Console integration
│   │   ├── bigquery.go           # BigQuery export
│   │   └── channels.go           # Channel grouping
│   └── seo/                      # SEO utilities
│       └── webvitals.go          # Core Web Vitals helpers
├── .golangci.yml                 # Linter configuration
├── Makefile                      # Build automation
├── main.go                       # Entry point
├── go.mod                        # Dependencies
├── CLAUDE.md                     # AI assistant instructions
├── IMPLEMENTATION_PLAN.md        # Development roadmap
└── PHASE4_SUMMARY.md             # Phase 4 completion summary
```

## ⚠️ API Limitations

### Audiences
❌ **Cannot be created via API** - Complex filter logic requires manual setup in GA4 UI
✅ Tool provides comprehensive documentation for manual creation

### Search Console Links
❌ **Cannot be created via API** - GA4 Admin API doesn't support this feature
✅ Tool generates detailed step-by-step setup guides

### BigQuery Links
⚠️ **Partially supported** - Can list and retrieve existing links
❌ Cannot create or delete links programmatically
✅ Tool generates detailed setup guides with recommended configurations

### Channel Groups
✅ **Fully supported** - All CRUD operations work correctly
✅ Fixed API compatibility issues (2025-11-22)

## 🔄 Recent Updates (2025-11-22)

### Code Quality Improvements
- ✅ Installed and configured `golangci-lint` v2.6.2
- ✅ Fixed all lint errors (0 issues)
- ✅ Added `make lint` command
- ✅ Build successful (20MB binary)

### API Compatibility Fixes
- ✅ Fixed BigQuery API types (removed non-existent Dataset field)
- ✅ Fixed Channel Groups API types (InListFilter, StringFilter, FilterExpressions)
- ✅ Fixed Link command project selection logic
- ✅ Fixed all unchecked error returns
- ✅ Simplified boolean comparisons

### Documentation Updates
- ✅ Updated CLAUDE.md with current architecture
- ✅ Updated IMPLEMENTATION_PLAN.md with Phase 4 status
- ✅ Added comprehensive changelog

## 📚 Documentation

- [CLAUDE.md](CLAUDE.md) - AI assistant guidance and project overview
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) - Detailed implementation roadmap
- [PHASE4_SUMMARY.md](PHASE4_SUMMARY.md) - Phase 4 completion details

## 🛠️ Troubleshooting

### Build Issues

```bash
# Clean and rebuild
make clean
make build

# Check Go version (requires 1.19+)
go version

# Verify dependencies
go mod verify
go mod tidy
```

### API Issues

```bash
# Verify credentials
echo $GOOGLE_APPLICATION_CREDENTIALS
cat .env

# Test API access
./ga4 report --project snapcompress
```

### Lint Issues

```bash
# Run linter
make lint

# Fix auto-fixable issues
golangci-lint run --fix
```

## 🤝 Contributing

This is a personal project, but suggestions and feedback are welcome via issues.

## 📄 License

Personal use only.

## 🔗 Links

- [Google Analytics Admin API](https://developers.google.com/analytics/devguides/config/admin/v1)
- [Core Web Vitals](https://web.dev/vitals/)
- [GA4 Best Practices](https://support.google.com/analytics/answer/9267744)

## 👤 Author

Oscar Gallego
- Email: info@oscargallegoruiz.com
- GitHub: [@garbarok](https://github.com/garbarok)

---

Made with ❤️ for better analytics tracking
