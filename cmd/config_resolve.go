package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"sort"

	"github.com/spf13/cobra"

	"github.com/garbarok/ga4-manager/internal/config"
)

// ResolvedConfig is the machine-readable subset of a project config that the
// MCP server's native tools need. The Go binary is the single YAML reader
// (design D4), so native tools ask for this instead of parsing YAML.
type ResolvedConfig struct {
	Path          string              `json:"path"`
	Project       string              `json:"project"`
	PropertyID    string              `json:"property_id"`
	GSCSite       string              `json:"gsc_site"`
	HreflangPairs []map[string]string `json:"hreflang_pairs"`
}

var (
	configResolvePath   string
	configResolveAll    bool
	configResolveFormat string
)

var configCmd = &cobra.Command{
	Use:   "config",
	Short: "Inspect project configuration files",
}

var configResolveCmd = &cobra.Command{
	Use:   "resolve",
	Short: "Print the resolved property, GSC site and hreflang pairs of config files",
	Long: `Load and validate one config (--config) or every operator config under
configs/*.yaml (--all; configs/examples/ templates are excluded) and print the
fields downstream tools need: project name, GA4 property ID, GSC site and
hreflang pairs.

Used by the MCP server's native tools so YAML is only ever parsed here.

Examples:
  ga4 config resolve --config configs/mysite.yaml --format json
  ga4 config resolve --all --format json`,
	RunE: func(cmd *cobra.Command, _ []string) error {
		if configResolveFormat != "json" {
			return fmt.Errorf("unsupported --format %q (only json)", configResolveFormat)
		}
		var paths []string
		switch {
		case configResolvePath != "":
			paths = []string{configResolvePath}
		case configResolveAll:
			matches, err := operatorConfigPaths("configs")
			if err != nil {
				return err
			}
			paths = matches
		default:
			return fmt.Errorf("specify --config <path> or --all")
		}
		return writeResolvedConfigs(cmd.OutOrStdout(), cmd.ErrOrStderr(), paths, configResolvePath != "")
	},
}

func init() {
	rootCmd.AddCommand(configCmd)
	configCmd.AddCommand(configResolveCmd)
	configResolveCmd.Flags().StringVarP(&configResolvePath, "config", "c", "", "Path to one configuration file")
	configResolveCmd.Flags().BoolVar(&configResolveAll, "all", false, "Resolve every configs/*.yaml (examples excluded)")
	configResolveCmd.Flags().StringVar(&configResolveFormat, "format", "json", "Output format (json)")
}

// operatorConfigPaths lists dir/*.yaml — deliberately not recursive, so the
// illustrative templates under dir/examples/ are never reported on.
func operatorConfigPaths(dir string) ([]string, error) {
	matches, err := filepath.Glob(filepath.Join(dir, "*.yaml"))
	if err != nil {
		return nil, err
	}
	sort.Strings(matches)
	return matches, nil
}

// writeResolvedConfigs loads each path and writes a JSON array. With strict
// set (a single explicit --config) a load failure is an error; for --all a
// broken config is skipped with a stderr warning, matching `report --all`.
func writeResolvedConfigs(stdout, stderr io.Writer, paths []string, strict bool) error {
	out := make([]ResolvedConfig, 0, len(paths))
	for _, p := range paths {
		cfg, err := config.LoadConfig(p)
		if err != nil {
			if strict {
				return fmt.Errorf("failed to load config: %w", err)
			}
			_, _ = fmt.Fprintf(stderr, "warning: skipping %s: %v\n", p, err)
			continue
		}
		out = append(out, resolveConfig(p, cfg))
	}
	enc := json.NewEncoder(stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(out)
}

func resolveConfig(path string, cfg *config.ProjectConfig) ResolvedConfig {
	rc := ResolvedConfig{
		Path:          path,
		Project:       cfg.Project.Name,
		PropertyID:    cfg.GetPropertyID(),
		HreflangPairs: []map[string]string{},
	}
	if cfg.SearchConsole != nil {
		rc.GSCSite = cfg.SearchConsole.SiteURL
		if cfg.SearchConsole.HreflangPairs != nil {
			rc.HreflangPairs = cfg.SearchConsole.HreflangPairs
		}
	}
	return rc
}
