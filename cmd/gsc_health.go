package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/garbarok/ga4-manager/internal/gsc"
	"github.com/garbarok/ga4-manager/internal/gsc/diagcmd"
	gscstate "github.com/garbarok/ga4-manager/internal/gsc/state"
)

const (
	healthCommandName = "gsc_health"

	// Coverage states the predicate considers "indexed and healthy". Any
	// movement out of this set is treated as a regression; any movement
	// into this set is treated as a recovery.
	healthCoverageStateIndexed = "Submitted and indexed"

	// Rich-results statuses considered passing.
	healthRichPass = "PASS"

	healthChangeRegression = "regression"
	healthChangeRecovery   = "recovery"
	healthChangeBaseline   = "baseline"
)

var (
	gscHealthConfig   string
	gscHealthFormat   string
	gscHealthStateDir string
	gscHealthDryRun   bool
)

var gscHealthCmd = &cobra.Command{
	Use:   "health",
	Short: "Weekly index-health diff against the prior snapshot",
	Long: `Inspect every URL declared under search_console.url_inspection.priority_urls
in the config file, diff each URL's coverage state against the prior snapshot,
and report regressions, recoveries, and first-time baselines. Designed to run
on a weekly cron so noindex bugs and canonical mismatches are caught within
days instead of weeks.

State per ADR-0005: ` + "`" + `.ga4-state/health.<site>.json` + "`" + ` (or use --state-dir
to override). Atomic temp-file-plus-rename writes; an interrupted run never
corrupts the snapshot.

Per-URL field-level diffs surface the following moves as regressions:
  coverage_state moving away from "Submitted and indexed"
  robots_blocked transitioning to true
  indexing_allowed transitioning to false
  rich_results_status moving away from "PASS"
  google_canonical changing

mobile_usable is recorded in the snapshot for transparency but is NOT diffed:
Google deprecated the Mobile Usability report/API field in December 2023, so an
absent verdict would otherwise look like a permanent regression on every URL.

Moves in the opposite direction are surfaced as recoveries (good news).

First-time URLs are surfaced as "baseline" entries — informational,
they don't count as regressions for exit-code purposes.

Each result carries the full current state of the URL so an LLM consumer
can decide how to triage without re-inspecting.

Quota cost: one URL Inspection request per priority URL. URL Inspection
has a 2000/day budget; the command does NOT deduplicate across runs (each
run inspects every priority URL fresh — that is the point).

Exit codes:
  0  no regressions (clean — silent on stdout aside from quota footer)
  2  at least one regression detected
  1  command failed (API error, malformed config, state write failure)

Examples:
  ga4 gsc health --config configs/mysite.yaml
  ga4 gsc health --config configs/mysite.yaml --format json
  ga4 gsc health --config configs/mysite.yaml --state-dir /var/lib/ga4-state
  ga4 gsc health --config configs/mysite.yaml --dry-run`,
	RunE: healthRunE,
}

func init() {
	gscCmd.AddCommand(gscHealthCmd)
	gscHealthCmd.Flags().StringVarP(&gscHealthConfig, "config", "c", "", "Path to configuration file (required)")
	gscHealthCmd.Flags().StringVar(&gscHealthFormat, "format", diagcmd.FormatTable, "Output format: table or json")
	gscHealthCmd.Flags().StringVar(&gscHealthStateDir, "state-dir", "", "Override the state directory (default .ga4-state/)")
	gscHealthCmd.Flags().BoolVar(&gscHealthDryRun, "dry-run", false, "Inspect and diff but do not write a new snapshot")
}

var gscHealthClientFactory = func() (gsc.InspectAPI, func(), error) {
	client, err := gsc.NewClient()
	if err != nil {
		return nil, func() {}, err
	}
	return client, func() { _ = client.Close() }, nil
}

// healthURLState is the per-URL payload persisted to disk and surfaced as
// the `current_state` of each result.
type healthURLState struct {
	CoverageState     string `json:"coverage_state"`
	GoogleCanonical   string `json:"google_canonical"`
	UserCanonical     string `json:"user_canonical"`
	RobotsBlocked   bool `json:"robots_blocked"`
	IndexingAllowed bool `json:"indexing_allowed"`
	// MobileUsable / MobileUsabilityChecked: Google deprecated the Mobile
	// Usability signal (Dec 2023). It is recorded for transparency but NOT
	// diffed for regressions — an absent verdict must not look like a failure.
	MobileUsable           bool   `json:"mobile_usable"`
	MobileUsabilityChecked bool   `json:"mobile_usability_checked"`
	RichResultsStatus      string `json:"rich_results_status"`
}

// healthFieldChange is one field-level diff inside a URL's result entry.
type healthFieldChange struct {
	Field  string `json:"field"`
	Before string `json:"before"`
	After  string `json:"after"`
}

// HealthResultRow is one URL whose state differed from the prior snapshot
// (or is being baselined). Stable URLs with no diffs are NOT emitted —
// the command is "silent on all-green".
type HealthResultRow struct {
	URL          string              `json:"url"`
	Change       string              `json:"change"` // regression | recovery | baseline
	Changes      []healthFieldChange `json:"changes,omitempty"`
	CurrentState healthURLState      `json:"current_state"`
}

// HealthOutput is the JSON envelope under --format json.
type HealthOutput = diagcmd.Envelope[HealthResultRow]

// stateData is the body of the snapshot's `data` field.
type stateData struct {
	URLs map[string]healthURLState `json:"urls"`
}

func healthRunE(_ *cobra.Command, _ []string) error {
	status := runHealthCommand(healthParams{
		ConfigPath: gscHealthConfig,
		Format:     gscHealthFormat,
		StateDir:   gscstate.ResolveStateDir(gscHealthStateDir),
		DryRun:     gscHealthDryRun,
		Factory:    gscHealthClientFactory,
		Stdout:     os.Stdout,
		Stderr:     os.Stderr,
		Now:        time.Now().UTC(),
	})
	os.Exit(status)
	return nil
}

type healthParams struct {
	ConfigPath string
	Format     string
	StateDir   string
	DryRun     bool
	Factory    func() (gsc.InspectAPI, func(), error)
	Stdout     io.Writer
	Stderr     io.Writer
	Now        time.Time
}

func runHealthCommand(p healthParams) int {
	if err := diagcmd.ValidateFormat(p.Format); err != nil {
		return diagcmd.FailWith(p.Stderr, "%v", err)
	}
	site, cfg, err := diagcmd.LoadSite(p.ConfigPath)
	if err != nil {
		return diagcmd.FailWith(p.Stderr, "%v", err)
	}
	if cfg.SearchConsole == nil || cfg.SearchConsole.URLInspection == nil || len(cfg.SearchConsole.URLInspection.PriorityURLs) == 0 {
		return diagcmd.FailWith(p.Stderr, "no search_console.url_inspection.priority_urls in %s", p.ConfigPath)
	}
	urls := cfg.SearchConsole.URLInspection.PriorityURLs

	client, cleanup, err := p.Factory()
	if err != nil {
		return diagcmd.FailWith(p.Stderr, "failed to create GSC client: %v", err)
	}
	defer cleanup()

	store := gscstate.NewStore(p.StateDir)
	prior, hasPrior, err := loadHealthSnapshot(store, site)
	if err != nil {
		return diagcmd.FailWith(p.Stderr, "%v", err)
	}

	currentByURL, inspections, err := inspectAllHealth(client, site, urls)
	if err != nil {
		return diagcmd.FailWith(p.Stderr, "%v", err)
	}

	rows := diffHealth(prior, currentByURL, hasPrior)
	hasRegression := false
	for _, r := range rows {
		if r.Change == healthChangeRegression {
			hasRegression = true
			break
		}
	}

	if !p.DryRun {
		if err := writeHealthSnapshot(store, site, currentByURL, p.Now); err != nil {
			return diagcmd.FailWith(p.Stderr, "failed to write state: %v", err)
		}
	}

	env := diagcmd.NewEnvelope(healthCommandName, site, p.Now, rows, inspections)
	if err := diagcmd.Render(p.Stdout, env, p.Format, healthColumns, healthTextRow); err != nil {
		return diagcmd.FailWith(p.Stderr, "failed to render output: %v", err)
	}

	return diagcmd.ExitCode(nil, hasRegression)
}

// loadHealthSnapshot returns the prior state map plus a flag indicating
// whether any prior state existed (false on the very first run). A missing
// snapshot is NOT an error — first-run is the baseline case.
func loadHealthSnapshot(store *gscstate.Store, site string) (map[string]healthURLState, bool, error) {
	snap, err := store.Read(context.Background(), healthCommandName, site)
	if err != nil {
		if errors.Is(err, gscstate.ErrSnapshotMissing) {
			return map[string]healthURLState{}, false, nil
		}
		return nil, false, fmt.Errorf("read state: %w", err)
	}
	var body stateData
	if err := json.Unmarshal(snap.Data, &body); err != nil {
		return nil, false, fmt.Errorf("parse state payload: %w", err)
	}
	if body.URLs == nil {
		body.URLs = map[string]healthURLState{}
	}
	return body.URLs, true, nil
}

func writeHealthSnapshot(store *gscstate.Store, site string, urls map[string]healthURLState, now time.Time) error {
	body := stateData{URLs: urls}
	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal state payload: %w", err)
	}
	_ = now // generated_at is set by the store; param retained for future fakes
	return store.Write(context.Background(), healthCommandName, site, payload)
}

func inspectAllHealth(client gsc.InspectAPI, site string, urls []string) (map[string]healthURLState, int, error) {
	// Deduplicate within this run, in case the config repeats a URL.
	seen := make(map[string]struct{}, len(urls))
	ordered := make([]string, 0, len(urls))
	for _, u := range urls {
		if _, ok := seen[u]; ok {
			continue
		}
		seen[u] = struct{}{}
		ordered = append(ordered, u)
	}

	state := make(map[string]healthURLState, len(ordered))
	for _, u := range ordered {
		r, err := client.InspectURL(site, u)
		if err != nil {
			return nil, 0, fmt.Errorf("inspect %s: %w", u, err)
		}
		state[u] = healthURLState{
			CoverageState:     r.CoverageState,
			GoogleCanonical:   r.GoogleCanonical,
			UserCanonical:     r.UserCanonical,
			RobotsBlocked:     r.RobotsBlocked,
			IndexingAllowed:   r.IndexingAllowed,
			MobileUsable:           r.MobileUsable,
			MobileUsabilityChecked: r.MobileUsabilityChecked,
			RichResultsStatus:      r.RichResultsStatus,
		}
	}
	return state, len(ordered), nil
}

// diffHealth produces one HealthResultRow per URL that materially changed
// (or is new in this run when hasPrior is true). Stable URLs are excluded.
//
// On the very first run (hasPrior == false) NO baseline rows are emitted —
// there is no prior to diff against and surfacing every URL as "baseline"
// would defeat silent-on-all-green. Subsequent runs surface newly-added
// URLs as baselines so the Operator knows new entries entered monitoring.
func diffHealth(prior, current map[string]healthURLState, hasPrior bool) []HealthResultRow {
	rows := make([]HealthResultRow, 0)

	urls := make([]string, 0, len(current))
	for u := range current {
		urls = append(urls, u)
	}
	sort.Strings(urls)

	for _, u := range urls {
		cur := current[u]
		old, existed := prior[u]
		if !existed {
			if !hasPrior {
				continue
			}
			rows = append(rows, HealthResultRow{
				URL:          u,
				Change:       healthChangeBaseline,
				CurrentState: cur,
			})
			continue
		}
		changes := compareHealthStates(old, cur)
		if len(changes) == 0 {
			continue
		}
		rows = append(rows, HealthResultRow{
			URL:          u,
			Change:       classifyHealthChanges(changes, old, cur),
			Changes:      changes,
			CurrentState: cur,
		})
	}
	return rows
}

// compareHealthStates returns the list of field-level diffs between two
// snapshots. Only fields that materially differ are emitted.
func compareHealthStates(before, after healthURLState) []healthFieldChange {
	var changes []healthFieldChange
	add := func(field, b, a string) {
		if b != a {
			changes = append(changes, healthFieldChange{Field: field, Before: b, After: a})
		}
	}
	addBool := func(field string, b, a bool) {
		if b != a {
			changes = append(changes, healthFieldChange{
				Field:  field,
				Before: boolToString(b),
				After:  boolToString(a),
			})
		}
	}
	add("coverage_state", before.CoverageState, after.CoverageState)
	add("google_canonical", before.GoogleCanonical, after.GoogleCanonical)
	add("user_canonical", before.UserCanonical, after.UserCanonical)
	addBool("robots_blocked", before.RobotsBlocked, after.RobotsBlocked)
	addBool("indexing_allowed", before.IndexingAllowed, after.IndexingAllowed)
	// mobile_usable is intentionally NOT diffed: Google deprecated the signal
	// (Dec 2023) and the API returns no verdict, so any movement is noise.
	add("rich_results_status", before.RichResultsStatus, after.RichResultsStatus)
	return changes
}

func boolToString(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

// classifyHealthChanges returns "regression", "recovery", or
// "baseline" depending on whether the field-level diffs collectively
// represent a worsening or improvement of the URL's health.
//
// A change is a regression if ANY field moved in the bad direction. A
// recovery requires the URL was previously unhealthy and is now back to
// the healthy baseline. Otherwise it falls through to a regression so the
// Operator sees the change explicitly.
func classifyHealthChanges(changes []healthFieldChange, before, after healthURLState) string {
	if anyChangeIsBad(changes, before, after) {
		return healthChangeRegression
	}
	if anyChangeIsGood(changes, before, after) {
		return healthChangeRecovery
	}
	// All changes were lateral (e.g. canonical text changed without changing
	// indexability). Treat as a regression so the Operator inspects.
	return healthChangeRegression
}

func anyChangeIsBad(changes []healthFieldChange, before, after healthURLState) bool {
	for _, c := range changes {
		switch c.Field {
		case "coverage_state":
			if before.CoverageState == healthCoverageStateIndexed &&
				after.CoverageState != healthCoverageStateIndexed {
				return true
			}
		case "robots_blocked":
			if !before.RobotsBlocked && after.RobotsBlocked {
				return true
			}
		case "indexing_allowed":
			if before.IndexingAllowed && !after.IndexingAllowed {
				return true
			}
		case "rich_results_status":
			if before.RichResultsStatus == healthRichPass &&
				after.RichResultsStatus != healthRichPass &&
				after.RichResultsStatus != "" {
				return true
			}
		case "google_canonical":
			// Any canonical change is worth surfacing — could be Google
			// re-canonicalising to a different page than the operator
			// declared.
			return true
		}
	}
	return false
}

func anyChangeIsGood(changes []healthFieldChange, before, after healthURLState) bool {
	for _, c := range changes {
		switch c.Field {
		case "coverage_state":
			if before.CoverageState != healthCoverageStateIndexed &&
				after.CoverageState == healthCoverageStateIndexed {
				return true
			}
		case "robots_blocked":
			if before.RobotsBlocked && !after.RobotsBlocked {
				return true
			}
		case "indexing_allowed":
			if !before.IndexingAllowed && after.IndexingAllowed {
				return true
			}
		case "rich_results_status":
			if before.RichResultsStatus != healthRichPass &&
				after.RichResultsStatus == healthRichPass {
				return true
			}
		}
	}
	return false
}

var healthColumns = []string{"url", "change", "fields", "coverage_state"}

func healthTextRow(r HealthResultRow) []string {
	fields := make([]string, 0, len(r.Changes))
	for _, c := range r.Changes {
		fields = append(fields, c.Field)
	}
	return []string{
		r.URL,
		r.Change,
		strings.Join(fields, ","),
		r.CurrentState.CoverageState,
	}
}
