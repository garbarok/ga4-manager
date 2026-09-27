package cmd

import (
	"bytes"
	"encoding/json"
	"testing"
	"time"

	"github.com/garbarok/ga4-manager/internal/gsc"
	"github.com/garbarok/ga4-manager/internal/gsc/diagcmd"
)

func runHygiene(t *testing.T, rows []gsc.SearchAnalyticsRow) (int, URLHygieneOutput, *fakeDimensionClient) {
	t.Helper()
	fake := &fakeDimensionClient{byDims: map[string][]gsc.SearchAnalyticsRow{"page": rows}}
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	status := runURLHygieneCommand(urlHygieneParams{
		ConfigPath: writeConfig(t, "sc-domain:x.app"),
		Format:     diagcmd.FormatJSON,
		Days:       urlHygieneDaysDefault,
		Factory:    func() (gsc.SearchAPI, func(), error) { return fake, func() {}, nil },
		Stdout:     stdout,
		Stderr:     stderr,
		Now:        time.Date(2026, 9, 27, 12, 0, 0, 0, time.UTC),
	})
	var env URLHygieneOutput
	if status != diagcmd.ExitFailure {
		if err := json.Unmarshal(stdout.Bytes(), &env); err != nil {
			t.Fatalf("invalid JSON: %v\n%s", err, stdout.String())
		}
	} else {
		t.Logf("stderr: %s", stderr.String())
	}
	return status, env, fake
}

func TestURLHygieneCommand_WarningsExit2(t *testing.T) {
	status, env, fake := runHygiene(t, []gsc.SearchAnalyticsRow{
		pageLevelRow("https://www.x.app/www.x.app/calculator/calculadora-hipoteca", 0, 1, 1),
		pageLevelRow("https://www.x.app/calculator/a/opengraph-image?f720", 0, 60, 4.3),
		pageLevelRow("https://www.x.app/privacy", 0, 21, 40),
	})
	if status != diagcmd.ExitIssues {
		t.Fatalf("status = %d, want %d", status, diagcmd.ExitIssues)
	}
	if env.Command != urlHygieneCommandName || env.QuotaUsed != 1 {
		t.Errorf("envelope = %+v", env)
	}
	if got := fake.queries[0].Dimensions; len(got) != 1 || got[0] != "page" {
		t.Errorf("dimensions = %v, want [page]", got)
	}
	if len(env.Results) != 3 || env.Results[0].Issue != "asset_route" || env.Results[1].Issue != "malformed_path" {
		t.Errorf("results = %+v", env.Results)
	}
}

func TestURLHygieneCommand_InfoOnlyExit0(t *testing.T) {
	status, env, _ := runHygiene(t, []gsc.SearchAnalyticsRow{
		pageLevelRow("https://www.x.app/terms", 0, 34, 30),
		pageLevelRow("https://www.x.app/calculator/a", 10, 500, 8),
	})
	if status != diagcmd.ExitClean {
		t.Fatalf("status = %d, want %d", status, diagcmd.ExitClean)
	}
	if len(env.Results) != 1 || env.Results[0].Severity != "info" {
		t.Errorf("results = %+v", env.Results)
	}
}

func TestURLHygieneCommand_CleanSiteExit0(t *testing.T) {
	status, env, _ := runHygiene(t, []gsc.SearchAnalyticsRow{pageLevelRow("https://www.x.app/", 10, 100, 3)})
	if status != diagcmd.ExitClean || len(env.Results) != 0 {
		t.Errorf("status = %d, results = %+v", status, env.Results)
	}
}

func TestURLHygieneCommand_RejectsBadDays(t *testing.T) {
	stderr := &bytes.Buffer{}
	status := runURLHygieneCommand(urlHygieneParams{
		ConfigPath: writeConfig(t, "sc-domain:x.app"),
		Format:     diagcmd.FormatJSON,
		Days:       0,
		Stdout:     &bytes.Buffer{},
		Stderr:     stderr,
	})
	if status != diagcmd.ExitFailure {
		t.Errorf("status = %d, want failure", status)
	}
}
