package state

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// SchemaVersion is the on-disk envelope version this build reads and writes.
// Bumping it is a breaking change: prior snapshots become unreadable and the
// Operator must delete the state file to rebaseline (see ADR-0005).
const SchemaVersion = 1

// defaultStateDir is the directory used when no override is supplied. It is
// resolved relative to the caller's working directory; expansion of "~" or
// other shell metacharacters is the caller's responsibility.
const defaultStateDir = ".ga4-state"

// Snapshot is the schema-versioned envelope persisted to disk. Data is
// json.RawMessage so each command can shape its own payload without this
// package having to know the inner structure.
type Snapshot struct {
	SchemaVersion int             `json:"schema_version"`
	Command       string          `json:"command"`
	Site          string          `json:"site"`
	GeneratedAt   time.Time       `json:"generated_at"`
	Data          json.RawMessage `json:"data"`
}

// Store reads and writes Snapshot files under a single state directory.
//
// Construction is intentionally minimal — Dir is the only required input — and
// the renameFn seam exists so tests can simulate an interrupted atomic write
// without resorting to time-of-check race tricks.
type Store struct {
	dir      string
	renameFn func(oldpath, newpath string) error
}

// NewStore returns a Store rooted at dir. The directory is created on demand
// during Write; Read against a non-existent directory yields ErrSnapshotMissing
// just like a missing file would.
func NewStore(dir string) *Store {
	return &Store{dir: dir, renameFn: os.Rename}
}

// Dir reports the state directory this Store was constructed with.
func (s *Store) Dir() string { return s.dir }

// Write persists data under (command, site) as a fresh snapshot generated at
// the current time. The write is atomic: bytes are first flushed to a temp
// file in the destination directory and only then renamed into place, so an
// interrupted run cannot leave a prior snapshot half-overwritten.
//
// The context is accepted for forward compatibility with future remote
// back-ends; the on-disk implementation honours cancellation only between the
// temp-file and rename steps.
func (s *Store) Write(ctx context.Context, command, site string, data json.RawMessage) error {
	if err := validateKey(command, site); err != nil {
		return err
	}
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return fmt.Errorf("gsc state: create state dir: %w", err)
	}

	snap := Snapshot{
		SchemaVersion: SchemaVersion,
		Command:       command,
		Site:          site,
		GeneratedAt:   time.Now().UTC(),
		Data:          data,
	}
	payload, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return fmt.Errorf("gsc state: marshal snapshot: %w", err)
	}

	dest := s.pathFor(command, site)

	// CreateTemp inside the destination directory keeps the rename on the same
	// filesystem; a cross-device rename would not be atomic and may outright
	// fail on some platforms.
	tmp, err := os.CreateTemp(s.dir, filepath.Base(dest)+".tmp-*")
	if err != nil {
		return fmt.Errorf("gsc state: create temp file: %w", err)
	}
	tmpName := tmp.Name()
	cleanup := func() { _ = os.Remove(tmpName) }

	if _, err := tmp.Write(payload); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("gsc state: write temp file: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("gsc state: fsync temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return fmt.Errorf("gsc state: close temp file: %w", err)
	}

	if err := ctx.Err(); err != nil {
		cleanup()
		return err
	}

	if err := s.renameFn(tmpName, dest); err != nil {
		cleanup()
		return fmt.Errorf("gsc state: rename temp file: %w", err)
	}
	return nil
}

// Read returns the snapshot persisted for (command, site). It returns
// ErrSnapshotMissing when no file exists and ErrSchemaVersionMismatch when the
// file's schema_version is not one this build understands.
func (s *Store) Read(_ context.Context, command, site string) (Snapshot, error) {
	if err := validateKey(command, site); err != nil {
		return Snapshot{}, err
	}

	path := s.pathFor(command, site)
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return Snapshot{}, ErrSnapshotMissing
		}
		return Snapshot{}, fmt.Errorf("gsc state: read snapshot: %w", err)
	}

	var snap Snapshot
	if err := json.Unmarshal(raw, &snap); err != nil {
		return Snapshot{}, fmt.Errorf("gsc state: parse snapshot %s: %w", path, err)
	}
	if snap.SchemaVersion != SchemaVersion {
		return Snapshot{}, fmt.Errorf("%w: got %d, want %d (file: %s)",
			ErrSchemaVersionMismatch, snap.SchemaVersion, SchemaVersion, path)
	}
	return snap, nil
}

// pathFor derives the on-disk path for a (command, site) pair.
func (s *Store) pathFor(command, site string) string {
	return filepath.Join(s.dir, command+"."+safeSite(site)+".json")
}

// safeSite rewrites a GSC site identifier into a portable filename component.
// GSC surfaces sites in two shapes: "sc-domain:example.com" (Domain property)
// and "https://example.com/" (URL-prefix property). Colon, forward slash, and
// backslash are all replaced with underscore so the resulting filename is
// portable across Windows, macOS, and Linux filesystems.
func safeSite(site string) string {
	r := strings.NewReplacer(":", "_", "/", "_", "\\", "_")
	return r.Replace(site)
}

// validateKey rejects empty command or site strings up-front; without both, the
// derived path would collide across calls and snapshots could not be retrieved.
func validateKey(command, site string) error {
	if command == "" || site == "" {
		return ErrInvalidKey
	}
	return nil
}

// ResolveStateDir returns the effective state directory: flagValue when the
// caller supplied --state-dir, otherwise the default ".ga4-state" relative to
// the current working directory. Path expansion (for example "~" → $HOME) is
// the caller's responsibility.
func ResolveStateDir(flagValue string) string {
	if flagValue != "" {
		return flagValue
	}
	return defaultStateDir
}
