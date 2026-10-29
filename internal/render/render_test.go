package render

import (
	"bytes"
	"errors"
	"fmt"
	"strings"
	"testing"
)

type row struct {
	name  string
	score int
}

func projectRow(r row) []string {
	return []string{r.name, fmt.Sprintf("%d", r.score)}
}

func sampleRows() []row {
	return []row{
		{name: "alpha", score: 1},
		{name: "beta", score: 22},
		{name: "gamma|escape", score: 333},
	}
}

var sampleColumns = []string{"name", "score"}

func TestRenderTableEmitsTabwriterAligned(t *testing.T) {
	var buf bytes.Buffer
	if err := Render(&buf, FormatTable, sampleColumns, sampleRows(), projectRow); err != nil {
		t.Fatalf("Render: %v", err)
	}
	out := buf.String()
	for _, want := range []string{"name", "score", "alpha", "beta", "gamma|escape", "333"} {
		if !strings.Contains(out, want) {
			t.Errorf("table output missing %q\n%s", want, out)
		}
	}
	lines := strings.Split(strings.TrimRight(out, "\n"), "\n")
	if len(lines) != 4 {
		t.Errorf("expected 4 lines (header + 3 rows), got %d\n%s", len(lines), out)
	}
}

func TestRenderCSVEmitsRFC4180(t *testing.T) {
	var buf bytes.Buffer
	if err := Render(&buf, FormatCSV, sampleColumns, sampleRows(), projectRow); err != nil {
		t.Fatalf("Render: %v", err)
	}
	out := buf.String()
	wantLines := []string{
		"name,score",
		"alpha,1",
		"beta,22",
		"gamma|escape,333",
	}
	got := strings.Split(strings.TrimRight(out, "\n"), "\n")
	if len(got) != len(wantLines) {
		t.Fatalf("expected %d lines, got %d\n%s", len(wantLines), len(got), out)
	}
	for i, want := range wantLines {
		if got[i] != want {
			t.Errorf("line %d: got %q, want %q", i, got[i], want)
		}
	}
}

func TestRenderMarkdownEmitsPipeTable(t *testing.T) {
	var buf bytes.Buffer
	if err := Render(&buf, FormatMarkdown, sampleColumns, sampleRows(), projectRow); err != nil {
		t.Fatalf("Render: %v", err)
	}
	out := buf.String()
	if !strings.Contains(out, "| name | score |") {
		t.Errorf("missing header row: %s", out)
	}
	if !strings.Contains(out, "| --- | --- |") {
		t.Errorf("missing separator row: %s", out)
	}
	if !strings.Contains(out, "| alpha | 1 |") {
		t.Errorf("missing data row: %s", out)
	}
	// Pipe character inside cell content must be escaped.
	if !strings.Contains(out, `gamma\|escape`) {
		t.Errorf("pipe character not escaped: %s", out)
	}
}

func TestRenderEmptyRowsStillEmitsHeader(t *testing.T) {
	tests := []struct {
		format     string
		wantHeader string
	}{
		{FormatTable, "name"},
		{FormatCSV, "name,score"},
		{FormatMarkdown, "| name | score |"},
	}
	for _, tc := range tests {
		t.Run(tc.format, func(t *testing.T) {
			var buf bytes.Buffer
			if err := Render(&buf, tc.format, sampleColumns, []row{}, projectRow); err != nil {
				t.Fatalf("Render: %v", err)
			}
			if !strings.Contains(buf.String(), tc.wantHeader) {
				t.Errorf("%s: empty rows should still emit header, got %q", tc.format, buf.String())
			}
		})
	}
}

func TestRenderUnknownFormatReturnsTypedError(t *testing.T) {
	var buf bytes.Buffer
	err := Render(&buf, "xml", sampleColumns, sampleRows(), projectRow)
	if err == nil {
		t.Fatal("expected error for unknown format")
	}
	if !errors.Is(err, ErrUnknownFormat) {
		t.Errorf("expected ErrUnknownFormat, got %v", err)
	}
}

func TestRenderArityMismatchReturnsError(t *testing.T) {
	badProjection := func(r row) []string { return []string{r.name} } // only 1 cell, columns has 2
	var buf bytes.Buffer
	err := Render(&buf, FormatTable, sampleColumns, sampleRows(), badProjection)
	if err == nil {
		t.Fatal("expected error for arity mismatch")
	}
	if !strings.Contains(err.Error(), "projection returned") {
		t.Errorf("error should mention projection arity: %v", err)
	}
}
