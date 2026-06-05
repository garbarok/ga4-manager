// Package diagcmd is the shared scaffolding for GSC diagnostic CLI commands.
//
// Every command under `ga4 gsc <diagnostic>` follows the same framework shape:
// a JSON envelope with {command, site, generated_at, results, quota_used};
// --format text|json; exit codes 0 (clean) / 2 (issues detected) / 1 (failure);
// "silent on all-green" stdout aside from the quota footer. This package owns
// those concerns so per-command code is reduced to the predicate-specific
// glue: build the query, apply the predicate, supply the text-row renderer.
//
// The conventions are normative — see docs/BACKLOG.md "Implementation notes"
// and the SEO Diagnostics section of CONTEXT.md.
package diagcmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/garbarok/ga4-manager/internal/config"
)

// Output format names, exported so command files reference these instead of
// duplicating string literals.
const (
	FormatText = "text"
	FormatJSON = "json"
)

// Framework exit codes. The CLI convention is fixed: anything that crosses
// these values is a framework change, not a per-command decision.
const (
	ExitClean   = 0
	ExitFailure = 1
	ExitIssues  = 2
)

// Envelope is the JSON output shape every diagnostic command emits under
// --format json and that the matching MCP tool consumes. The Results slice
// is typed: each command supplies its own row type as the type parameter.
type Envelope[T any] struct {
	Command     string `json:"command"`
	Site        string `json:"site"`
	GeneratedAt string `json:"generated_at"`
	Results     []T    `json:"results"`
	QuotaUsed   int    `json:"quota_used"`
}

// NewEnvelope returns an envelope with GeneratedAt formatted as RFC3339 and
// Results never nil — JSON consumers see an empty array rather than null.
func NewEnvelope[T any](command, site string, now time.Time, results []T, quotaUsed int) Envelope[T] {
	if results == nil {
		results = make([]T, 0)
	}
	return Envelope[T]{
		Command:     command,
		Site:        site,
		GeneratedAt: now.Format(time.RFC3339),
		Results:     results,
		QuotaUsed:   quotaUsed,
	}
}

// Render writes env to w in the requested format.
//
// In JSON mode, the entire envelope is encoded with two-space indentation.
//
// In text mode, an empty Results slice prints only the framework's
// `quota used: N` footer (the "silent on all-green" convention). When
// Results is non-empty, columns is emitted as a tab-separated header and
// rowFn is called for each result to produce the row cells; the final
// footer line is `quota used: N`.
func Render[T any](w io.Writer, env Envelope[T], format string, columns []string, rowFn func(T) []string) error {
	if format == FormatJSON {
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		return enc.Encode(env)
	}

	if len(env.Results) > 0 {
		tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
		if _, err := fmt.Fprintln(tw, strings.Join(columns, "\t")); err != nil {
			return err
		}
		for _, r := range env.Results {
			if _, err := fmt.Fprintln(tw, strings.Join(rowFn(r), "\t")); err != nil {
				return err
			}
		}
		if err := tw.Flush(); err != nil {
			return err
		}
	}
	_, err := fmt.Fprintf(w, "quota used: %d\n", env.QuotaUsed)
	return err
}

// ExitCode maps an outcome to the framework exit convention: any error → 1,
// otherwise non-empty results → 2 (issues detected) and empty → 0 (clean).
func ExitCode(err error, hasResults bool) int {
	if err != nil {
		return ExitFailure
	}
	if hasResults {
		return ExitIssues
	}
	return ExitClean
}

// FailWith writes a printf-formatted message followed by a newline to w and
// returns ExitFailure. Per-command runners use this as the one-liner for any
// path that needs to surface an error and exit 1. The write error is
// intentionally ignored — there is no meaningful recovery if stderr itself
// cannot be written to.
func FailWith(w io.Writer, format string, args ...any) int {
	_, _ = fmt.Fprintf(w, format+"\n", args...)
	return ExitFailure
}

// ValidateFormat returns an error if format is not one of the supported
// output formats. Commands call this once on entry to fail fast.
func ValidateFormat(format string) error {
	if format != FormatText && format != FormatJSON {
		return fmt.Errorf("invalid --format %q: must be %s or %s", format, FormatText, FormatJSON)
	}
	return nil
}

// LoadSite loads the YAML config at configPath and returns the GSC site URL
// declared under search_console.site_url. The full *config.ProjectConfig is also
// returned for callers that need other fields (priority URLs, etc.).
//
// An empty configPath, a load failure, or a missing search_console.site_url
// each yield an error suitable for direct emission to stderr.
func LoadSite(configPath string) (string, *config.ProjectConfig, error) {
	if configPath == "" {
		return "", nil, errors.New("--config is required")
	}
	cfg, err := config.LoadConfig(configPath)
	if err != nil {
		return "", nil, fmt.Errorf("failed to load config: %w", err)
	}
	if cfg.SearchConsole == nil || cfg.SearchConsole.SiteURL == "" {
		return "", cfg, fmt.Errorf("no search_console.site_url in %s", configPath)
	}
	return cfg.SearchConsole.SiteURL, cfg, nil
}
