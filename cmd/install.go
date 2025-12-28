package cmd

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/fatih/color"
)

// offerAutoInstall checks if the binary is running from a non-standard location
// and offers to install it system-wide for easier access
func offerAutoInstall() {
	// Get the current executable path
	execPath, err := os.Executable()
	if err != nil {
		return // Silently skip if we can't determine path
	}

	// Resolve symlinks
	execPath, err = filepath.EvalSymlinks(execPath)
	if err != nil {
		return
	}

	// Check if already installed in a system location
	if isInstalledInSystemPath(execPath) {
		return
	}

	// Check if this is a development environment (git repo)
	if isInGitRepo(execPath) {
		return
	}

	// Offer to install
	promptAutoInstall(execPath)
}

// isInstalledInSystemPath checks if the executable is already in a standard system path
func isInstalledInSystemPath(execPath string) bool {
	systemPaths := []string{
		"/usr/local/bin",
		"/usr/bin",
		"/bin",
		"/opt/homebrew/bin",
	}

	for _, sysPath := range systemPaths {
		if strings.HasPrefix(execPath, sysPath) {
			return true
		}
	}

	return false
}

// isInGitRepo checks if the executable is in a git repository (development environment)
func isInGitRepo(execPath string) bool {
	dir := filepath.Dir(execPath)
	cmd := exec.Command("git", "rev-parse", "--git-dir")
	cmd.Dir = dir
	err := cmd.Run()
	return err == nil
}

// promptAutoInstall displays the auto-install prompt and handles user choice
func promptAutoInstall(execPath string) {
	cyan := color.New(color.FgCyan).SprintFunc()
	yellow := color.New(color.FgYellow).SprintFunc()
	green := color.New(color.FgGreen).SprintFunc()

	fmt.Println()
	fmt.Println(cyan("📦 Installation Options"))
	fmt.Println(strings.Repeat("═", 50))
	fmt.Println()
	fmt.Println("To run GA4 Manager from anywhere without " + yellow("./") + ", you need to install it to your system PATH.")
	fmt.Println()
	fmt.Println(yellow("Option 1: Automatic Installation (Recommended)"))
	fmt.Println("  • Installs to: " + green("/usr/local/bin/ga4"))
	fmt.Println("  • Requires: sudo password (for system directory access)")
	fmt.Println("  • After install: Run " + cyan("ga4") + " from anywhere")
	fmt.Println()
	fmt.Println(yellow("Option 2: Manual Installation"))
	fmt.Println("  • You handle installation yourself")
	fmt.Println("  • Continue using: " + cyan("./ga4"))
	fmt.Println()
	fmt.Print("Would you like to install automatically? (Y/n): ")

	reader := bufio.NewReader(os.Stdin)
	response, _ := reader.ReadString('\n')
	response = strings.TrimSpace(strings.ToLower(response))

	// Default to yes if empty or 'y'
	if response == "" || response == "y" || response == "yes" {
		fmt.Println()
		performAutoInstall(execPath)
	} else {
		fmt.Println()
		showManualInstallInstructions(execPath)
	}
}

// performAutoInstall attempts to install the binary to /usr/local/bin
func performAutoInstall(execPath string) {
	cyan := color.New(color.FgCyan).SprintFunc()
	yellow := color.New(color.FgYellow).SprintFunc()
	green := color.New(color.FgGreen).SprintFunc()
	red := color.New(color.FgRed).SprintFunc()

	installPath := "/usr/local/bin/ga4"

	fmt.Println(yellow("🔒 Why sudo is needed:"))
	fmt.Println("   /usr/local/bin is a system directory that requires administrator")
	fmt.Println("   privileges to write files. This ensures only authorized users can")
	fmt.Println("   install system-wide commands.")
	fmt.Println()
	fmt.Println(cyan("Installing..."))
	fmt.Println()

	// Check if /usr/local/bin exists, create if not
	binDir := "/usr/local/bin"
	if _, err := os.Stat(binDir); os.IsNotExist(err) {
		cmd := exec.Command("sudo", "mkdir", "-p", binDir)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		cmd.Stdin = os.Stdin
		if err := cmd.Run(); err != nil {
			fmt.Println(red("✗ Failed to create /usr/local/bin directory"))
			fmt.Println()
			showManualInstallInstructions(execPath)
			return
		}
	}

	// Copy the binary
	cmd := exec.Command("sudo", "cp", execPath, installPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin

	if err := cmd.Run(); err != nil {
		fmt.Println()
		fmt.Println(red("✗ Installation failed"))
		fmt.Println()
		fmt.Println("This could be because:")
		fmt.Println("  • Sudo password was incorrect or cancelled")
		fmt.Println("  • Insufficient permissions")
		fmt.Println()
		showManualInstallInstructions(execPath)
		return
	}

	// Make sure it's executable
	cmd = exec.Command("sudo", "chmod", "+x", installPath)
	cmd.Run() // Ignore errors, likely already executable

	fmt.Println()
	fmt.Println(green("✓ Successfully installed to " + installPath))
	fmt.Println()
	fmt.Println(cyan("🎉 You can now run:"))
	fmt.Println("   " + green("ga4") + " --version")
	fmt.Println("   " + green("ga4") + " report --all")
	fmt.Println("   " + green("ga4") + " setup --config configs/my-project.yaml")
	fmt.Println()
	fmt.Println(yellow("Note: ") + "You may need to open a new terminal for PATH changes to take effect.")
	fmt.Println()
	fmt.Println(yellow("Press Enter to continue..."))
	fmt.Scanln()
}

// showManualInstallInstructions displays manual installation steps
func showManualInstallInstructions(execPath string) {
	cyan := color.New(color.FgCyan).SprintFunc()
	yellow := color.New(color.FgYellow).SprintFunc()
	green := color.New(color.FgGreen).SprintFunc()

	fmt.Println(yellow("📝 Manual Installation Instructions"))
	fmt.Println(strings.Repeat("─", 50))
	fmt.Println()
	fmt.Println("To install GA4 Manager manually, choose one of these options:")
	fmt.Println()

	fmt.Println(cyan("Option 1: Install to system PATH (Recommended)"))
	fmt.Println("────────────────────────────────────────────────")
	fmt.Println(green("sudo cp " + execPath + " /usr/local/bin/ga4"))
	fmt.Println(green("sudo chmod +x /usr/local/bin/ga4"))
	fmt.Println()
	fmt.Println("Then run: " + cyan("ga4") + " from anywhere")
	fmt.Println()

	fmt.Println(cyan("Option 2: Add current location to PATH"))
	fmt.Println("────────────────────────────────────────────────")
	execDir := filepath.Dir(execPath)

	// Detect shell and provide appropriate instructions
	shell := os.Getenv("SHELL")

	if strings.Contains(shell, "fish") {
		fmt.Println("For Fish shell (detected), add to " + cyan("~/.config/fish/config.fish") + ":")
		fmt.Println(green("fish_add_path " + execDir))
		fmt.Println()
		fmt.Println("Or create an alias:")
		fmt.Println(green("alias ga4='" + execPath + "'"))
	} else if strings.Contains(shell, "zsh") {
		fmt.Println("For Zsh (detected), add to " + cyan("~/.zshrc") + ":")
		fmt.Println(green("export PATH=\"" + execDir + ":$PATH\""))
		fmt.Println()
		fmt.Println("Or create an alias:")
		fmt.Println(green("alias ga4='" + execPath + "'"))
	} else {
		// Default to bash
		fmt.Println("For Bash, add to " + cyan("~/.bashrc") + " or " + cyan("~/.bash_profile") + ":")
		fmt.Println(green("export PATH=\"" + execDir + ":$PATH\""))
		fmt.Println()
		fmt.Println("Or create an alias:")
		fmt.Println(green("alias ga4='" + execPath + "'"))
	}

	fmt.Println()
	fmt.Println("Then reload your shell:")
	if strings.Contains(shell, "fish") {
		fmt.Println(green("source ~/.config/fish/config.fish"))
	} else if strings.Contains(shell, "zsh") {
		fmt.Println(green("source ~/.zshrc"))
	} else {
		fmt.Println(green("source ~/.bashrc"))
	}
	fmt.Println()

	fmt.Println(cyan("Option 3: Continue using ./ga4"))
	fmt.Println("────────────────────────────────────────────────")
	fmt.Println("Run from current directory:")
	fmt.Println(green("./ga4") + " --version")
	fmt.Println(green("./ga4") + " report --all")
	fmt.Println()

	fmt.Println(yellow("Press Enter to continue..."))
	fmt.Scanln()
}
