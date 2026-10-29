package diagcmd

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"strconv"
	"testing"
	"time"
)

type row struct {
	Name  string `json:"name"`
	Score int    `json:"score"`
}

func sampleEnvelope() Envelope[row] {
	return NewEnvelope("gsc_sample", "sc-domain:example.com",
		time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC),
		[]row{{Name: "a", Score: 1}, {Name: "b", Score: 2}},
		3,
	)
}

func TestNewEnvelopeNilResultsBecomesEmptySlice(t *testing.T) {
	env := NewEnvelope[row]("c", "s", time.Now(), nil, 0)
	if env.Results == nil || len(env.Results) != 0 {
		t.Fatalf("nil results should normalise to empty slice, got %#v", env.Results)
	}
}

func TestRenderJSONEncodesEnvelope(t *testing.T) {
	var buf bytes.Buffer
	if err := Render(&buf, sampleEnvelope(), FormatJSON, nil, nil); err != nil {
		t.Fatalf("Render JSON: %v", err)
	}
	var got Envelope[row]
	if err := json.Unmarshal(buf.Bytes(), &got); err != nil {
		t.Fatalf("invalid JSON: %v\n%s", err, buf.String())
	}
	if got.Command != "gsc_sample" || got.Site != "sc-domain:example.com" {
		t.Errorf("envelope fields wrong: %#v", got)
	}
	if got.GeneratedAt != "2026-06-05T12:00:00Z" {
		t.Errorf("generated_at = %q", got.GeneratedAt)
	}
	if got.QuotaUsed != 3 {
		t.Errorf("quota_used = %d, want 3", got.QuotaUsed)
	}
	if len(got.Results) != 2 {
		t.Errorf("results len = %d, want 2", len(got.Results))
	}
}

func TestRenderTextPrintsHeaderRowsAndFooter(t *testing.T) {
	var buf bytes.Buffer
	err := Render(&buf, sampleEnvelope(), FormatTable,
		[]string{"name", "score"},
		func(r row) []string { return []string{r.Name, strconv.Itoa(r.Score)} },
	)
	if err != nil {
		t.Fatalf("Render text: %v", err)
	}
	out := buf.String()
	if !strings.Contains(out, "name") || !strings.Contains(out, "score") {
		t.Errorf("header missing: %q", out)
	}
	if !strings.Contains(out, "a") || !strings.Contains(out, "b") {
		t.Errorf("row data missing: %q", out)
	}
	if !strings.HasSuffix(strings.TrimRight(out, "\n"), "quota used: 3") {
		t.Errorf("footer missing or misplaced: %q", out)
	}
}

func TestRenderTextEmptyResultsPrintsOnlyFooter(t *testing.T) {
	env := NewEnvelope[row]("gsc_sample", "sc-domain:example.com", time.Now(), nil, 7)
	var buf bytes.Buffer
	err := Render(&buf, env, FormatTable,
		[]string{"name", "score"},
		func(r row) []string { return []string{r.Name, strconv.Itoa(r.Score)} },
	)
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if buf.String() != "quota used: 7\n" {
		t.Errorf("silent-on-all-green violated: %q", buf.String())
	}
}

func TestExitCodeMapping(t *testing.T) {
	cases := []struct {
		err        error
		hasResults bool
		want       int
	}{
		{nil, false, ExitClean},
		{nil, true, ExitIssues},
		{errors.New("boom"), false, ExitFailure},
		{errors.New("boom"), true, ExitFailure},
	}
	for _, c := range cases {
		got := ExitCode(c.err, c.hasResults)
		if got != c.want {
			t.Errorf("ExitCode(err=%v, hasResults=%v) = %d, want %d", c.err, c.hasResults, got, c.want)
		}
	}
}

func TestValidateFormat(t *testing.T) {
	if err := ValidateFormat(FormatTable); err != nil {
		t.Errorf("text should be valid, got %v", err)
	}
	if err := ValidateFormat(FormatJSON); err != nil {
		t.Errorf("json should be valid, got %v", err)
	}
	if err := ValidateFormat("xml"); err == nil {
		t.Error("xml should be invalid")
	}
}
