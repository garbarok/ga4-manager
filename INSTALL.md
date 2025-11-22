# Installation Guide

## Quick Install (macOS/Linux)

### macOS (Apple Silicon)
```bash
# Download
curl -L https://github.com/garbarok/ga4-manager/releases/latest/download/ga4-darwin-arm64.tar.gz | tar xz

# Install
sudo mv ga4-darwin-arm64 /usr/local/bin/ga4
chmod +x /usr/local/bin/ga4

# Verify
ga4 --version
```

### macOS (Intel)
```bash
# Download
curl -L https://github.com/garbarok/ga4-manager/releases/latest/download/ga4-darwin-amd64.tar.gz | tar xz

# Install
sudo mv ga4-darwin-amd64 /usr/local/bin/ga4
chmod +x /usr/local/bin/ga4

# Verify
ga4 --version
```

### Linux (x86_64)
```bash
# Download
curl -L https://github.com/garbarok/ga4-manager/releases/latest/download/ga4-linux-amd64.tar.gz | tar xz

# Install
sudo mv ga4-linux-amd64 /usr/local/bin/ga4
chmod +x /usr/local/bin/ga4

# Verify
ga4 --version
```

### Linux (ARM64)
```bash
# Download
curl -L https://github.com/garbarok/ga4-manager/releases/latest/download/ga4-linux-arm64.tar.gz | tar xz

# Install
sudo mv ga4-linux-arm64 /usr/local/bin/ga4
chmod +x /usr/local/bin/ga4

# Verify
ga4 --version
```

### Windows (PowerShell)
```powershell
# Download
Invoke-WebRequest -Uri "https://github.com/garbarok/ga4-manager/releases/latest/download/ga4-windows-amd64.zip" -OutFile "ga4.zip"

# Extract
Expand-Archive -Path ga4.zip -DestinationPath .

# Move to PATH (adjust path as needed)
Move-Item ga4-windows-amd64.exe C:\Windows\System32\ga4.exe

# Verify
ga4 --version
```

---

## Manual Installation

### 1. Download from GitHub Releases

Visit [https://github.com/garbarok/ga4-manager/releases](https://github.com/garbarok/ga4-manager/releases)

Download the appropriate binary for your platform:
- **macOS (Apple Silicon)**: `ga4-darwin-arm64.tar.gz`
- **macOS (Intel)**: `ga4-darwin-amd64.tar.gz`
- **Linux (x86_64)**: `ga4-linux-amd64.tar.gz`
- **Linux (ARM64)**: `ga4-linux-arm64.tar.gz`
- **Windows (x86_64)**: `ga4-windows-amd64.zip`

### 2. Extract the Archive

**macOS/Linux**:
```bash
tar -xzf ga4-*.tar.gz
```

**Windows**:
Right-click the ZIP file and select "Extract All"

### 3. Move to PATH

**macOS/Linux**:
```bash
sudo mv ga4-* /usr/local/bin/ga4
chmod +x /usr/local/bin/ga4
```

**Windows**:
Move `ga4-windows-amd64.exe` to a directory in your PATH (e.g., `C:\Windows\System32\ga4.exe`)

### 4. Verify Installation

```bash
ga4 --version
ga4 --help
```

---

## Build from Source

### Prerequisites
- Go 1.21 or higher
- Git

### Steps

```bash
# Clone repository
git clone https://github.com/garbarok/ga4-manager.git
cd ga4-manager

# Download dependencies
go mod download

# Build binary
make build

# Install globally (optional)
sudo make install
```

---

## Configuration

After installation, set up your Google Cloud credentials. You have **two options**:

### Option 1: Add to Shell Configuration (Recommended for Global Use)

This makes the credentials available every time you use the terminal.

**For Bash** (add to `~/.bashrc` or `~/.bash_profile`):
```bash
echo 'export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/credentials.json"' >> ~/.bashrc
echo 'export GOOGLE_CLOUD_PROJECT="your-project-id"' >> ~/.bashrc
source ~/.bashrc
```

**For Zsh** (add to `~/.zshrc`):
```bash
echo 'export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/credentials.json"' >> ~/.zshrc
echo 'export GOOGLE_CLOUD_PROJECT="your-project-id"' >> ~/.zshrc
source ~/.zshrc
```

**For Fish** (add to `~/.config/fish/config.fish`):
```bash
echo 'set -gx GOOGLE_APPLICATION_CREDENTIALS /path/to/your/credentials.json' >> ~/.config/fish/config.fish
echo 'set -gx GOOGLE_CLOUD_PROJECT your-project-id' >> ~/.config/fish/config.fish
source ~/.config/fish/config.fish
```

### Option 2: Use a Local `.env` File (Project-Specific)

If you're building from source or want project-specific credentials:

```bash
# Create a .env file in your working directory
cat > .env << 'EOF'
GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/credentials.json
GOOGLE_CLOUD_PROJECT=your-project-id
EOF

# Set secure permissions
chmod 600 .env
```

The app will automatically load `.env` from your current directory.

### Option 3: Set for Current Session Only

```bash
# Export variables temporarily (only for current terminal session)
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/credentials.json"
export GOOGLE_CLOUD_PROJECT="your-project-id"

# Now run ga4 commands
ga4 report --project snapcompress
```

**Security Best Practices:**
- Store credentials outside publicly accessible directories
- Set restrictive permissions: `chmod 600 /path/to/credentials.json`
- Never commit credential files to version control
- Use different service accounts for different environments

### Verify Setup

```bash
# Check version (should not show credential warning)
ga4 --version

# View available commands
ga4 --help

# Test with dry-run
ga4 setup --project snapcompress --dry-run
```

---

## Usage Examples

```bash
# View configuration reports
ga4 report --project snapcompress
ga4 report --project personal
ga4 report --all

# Setup GA4 properties (requires credentials)
ga4 setup --project snapcompress --dry-run  # Preview changes
ga4 setup --project snapcompress            # Apply changes

# Cleanup unused items
ga4 cleanup --project personal --dry-run    # Preview cleanup
ga4 cleanup --project personal              # Remove items

# Link external services
ga4 link status --project snapcompress
ga4 link channels --project snapcompress
```

---

## Troubleshooting

### Command not found

If you get "command not found" after installation:

1. Check if `/usr/local/bin` is in your PATH:
   ```bash
   echo $PATH
   ```

2. Add to PATH if missing (add to `~/.bashrc` or `~/.zshrc`):
   ```bash
   export PATH="/usr/local/bin:$PATH"
   ```

3. Reload shell configuration:
   ```bash
   source ~/.bashrc  # or ~/.zshrc
   ```

### Permission denied

If you get "permission denied":

```bash
chmod +x /usr/local/bin/ga4
```

### Credentials not found

Ensure your `.env` file exists and has the correct path:

```bash
cat .env
ls -l $(grep GOOGLE_APPLICATION_CREDENTIALS .env | cut -d= -f2)
```

---

## Uninstallation

### Remove global binary

```bash
sudo rm /usr/local/bin/ga4
```

### Remove repository (if built from source)

```bash
rm -rf ~/path/to/ga4-manager
```

---

## Next Steps

- Read the [README.md](README.md) for feature overview
- Check [SECURITY.md](SECURITY.md) for security best practices
- View [CLAUDE.md](CLAUDE.md) for development documentation
- Report issues at [GitHub Issues](https://github.com/garbarok/ga4-manager/issues)

---

## Support

For help and questions:
- GitHub Issues: [https://github.com/garbarok/ga4-manager/issues](https://github.com/garbarok/ga4-manager/issues)
- Documentation: [https://github.com/garbarok/ga4-manager](https://github.com/garbarok/ga4-manager)
