// Package state persists diff-based GSC diagnostics output as schema-versioned
// JSON snapshots, one file per (command, gsc_site) pair, under a project-local
// state directory (default: .ga4-state/ relative to the working directory; the
// CLI may override via --state-dir). Writes are atomic via temp-file-plus-rename
// inside the destination directory so an interrupted run cannot leave the prior
// snapshot in a half-written state.
//
// This package is the substrate consumed by future stateful GSC commands
// (the first will be the Weekly Index Health Report). It does not depend on
// the GSC client and performs no I/O against any external API.
//
// See docs/adr/0005-stateful-gsc-diagnostics-storage.md for the architectural
// rationale.
package state
