// Package render is the shared tabular Renderer for ga4-manager CLI commands.
//
// One generic function — Render — accepts a slice of typed rows plus a
// projection function to flatten each row into string cells, and writes the
// table in one of three formats: table (tabwriter-aligned plain text), csv
// (RFC 4180), or markdown (pipe-table). JSON serialisation is intentionally
// not handled here: each command owns its own JSON envelope shape, because
// downstream consumers expect command-specific fields (aggregates, metadata,
// quota footers) that no general renderer should impose.
//
// Color, emoji, titles, and summary footers stay in the caller. The Renderer
// emits plain text only — safe for redirection, pipelines, and CI logs.
package render

import (
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"strings"
	"text/tabwriter"
)

// Canonical format names. No aliases — exactly one string per format.
const (
	FormatTable    = "table"
	FormatCSV      = "csv"
	FormatMarkdown = "markdown"
)

// ErrUnknownFormat is returned when Render is given a format string that is
// not one of FormatTable, FormatCSV, or FormatMarkdown.
var ErrUnknownFormat = errors.New("render: unknown format")

// Render writes the rows to w in the requested format.
//
// columns is the header row; rowFn projects each row to its cells. The
// projection must return a slice of the same length as columns — Render
// returns an error if the projection length differs, rather than emitting a
// ragged table.
//
// An empty rows slice still emits the header (and an empty CSV/markdown
// structure) so downstream parsers see a well-formed document. Callers that
// want "silent on empty" should check len(rows) before calling Render.
func Render[T any](
	w io.Writer,
	format string,
	columns []string,
	rows []T,
	rowFn func(T) []string,
) error {
	switch format {
	case FormatTable:
		return renderTable(w, columns, rows, rowFn)
	case FormatCSV:
		return renderCSV(w, columns, rows, rowFn)
	case FormatMarkdown:
		return renderMarkdown(w, columns, rows, rowFn)
	default:
		return fmt.Errorf("%w: %q (want %s, %s, or %s)",
			ErrUnknownFormat, format, FormatTable, FormatCSV, FormatMarkdown)
	}
}

func renderTable[T any](w io.Writer, columns []string, rows []T, rowFn func(T) []string) error {
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	if _, err := fmt.Fprintln(tw, strings.Join(columns, "\t")); err != nil {
		return err
	}
	for _, r := range rows {
		cells := rowFn(r)
		if err := assertArity(len(cells), len(columns)); err != nil {
			return err
		}
		if _, err := fmt.Fprintln(tw, strings.Join(cells, "\t")); err != nil {
			return err
		}
	}
	return tw.Flush()
}

func renderCSV[T any](w io.Writer, columns []string, rows []T, rowFn func(T) []string) error {
	cw := csv.NewWriter(w)
	if err := cw.Write(columns); err != nil {
		return err
	}
	for _, r := range rows {
		cells := rowFn(r)
		if err := assertArity(len(cells), len(columns)); err != nil {
			return err
		}
		if err := cw.Write(cells); err != nil {
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}

func renderMarkdown[T any](w io.Writer, columns []string, rows []T, rowFn func(T) []string) error {
	if _, err := fmt.Fprintf(w, "| %s |\n", strings.Join(columns, " | ")); err != nil {
		return err
	}
	sep := make([]string, len(columns))
	for i := range sep {
		sep[i] = "---"
	}
	if _, err := fmt.Fprintf(w, "| %s |\n", strings.Join(sep, " | ")); err != nil {
		return err
	}
	for _, r := range rows {
		cells := rowFn(r)
		if err := assertArity(len(cells), len(columns)); err != nil {
			return err
		}
		escaped := make([]string, len(cells))
		for i, c := range cells {
			escaped[i] = strings.ReplaceAll(c, "|", `\|`)
		}
		if _, err := fmt.Fprintf(w, "| %s |\n", strings.Join(escaped, " | ")); err != nil {
			return err
		}
	}
	return nil
}

func assertArity(got, want int) error {
	if got != want {
		return fmt.Errorf("render: projection returned %d cells, want %d", got, want)
	}
	return nil
}
