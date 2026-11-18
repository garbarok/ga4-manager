package config

import (
	"os"
	"path/filepath"
	"strings"
)

// ConfigDirEnv names extra directories (os.PathListSeparator-separated) that
// hold operator configs. It lets the MCP server, Claude Desktop (which starts
// servers in "/") and cron find configs regardless of the working directory.
const ConfigDirEnv = "GA4M_CONFIG_DIR"

// OperatorConfigDirs returns the directories searched for operator configs,
// in priority order, without duplicates:
//  1. each entry of $GA4M_CONFIG_DIR
//  2. ./configs (the working directory)
//  3. configs/ next to the ga4 binary (a repo checkout built with `make build`)
//  4. ~/.config/ga4-manager/configs
//
// Example templates (configs/examples) are not operator configs; see ExampleConfigDirs.
func OperatorConfigDirs() []string {
	var dirs []string
	if env := os.Getenv(ConfigDirEnv); env != "" {
		for _, d := range filepath.SplitList(env) {
			if d = strings.TrimSpace(d); d != "" {
				dirs = append(dirs, d)
			}
		}
	}
	dirs = append(dirs, "configs")
	if exe, err := os.Executable(); err == nil {
		if real, err := filepath.EvalSymlinks(exe); err == nil {
			exe = real
		}
		dirs = append(dirs, filepath.Join(filepath.Dir(exe), "configs"))
	}
	if home, err := os.UserHomeDir(); err == nil {
		dirs = append(dirs, filepath.Join(home, ".config", "ga4-manager", "configs"))
	}
	return uniqueDirs(dirs)
}

// ExampleConfigDirs returns the example-template directories (configs/examples
// under each operator directory), searched after every operator directory.
func ExampleConfigDirs() []string {
	var dirs []string
	for _, d := range OperatorConfigDirs() {
		dirs = append(dirs, filepath.Join(d, "examples"))
	}
	return uniqueDirs(dirs)
}

// uniqueDirs drops duplicates by absolute path, keeping the first occurrence.
func uniqueDirs(dirs []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(dirs))
	for _, d := range dirs {
		key := d
		if abs, err := filepath.Abs(d); err == nil {
			key = abs
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, d)
	}
	return out
}
