package state

import "errors"

// ErrSnapshotMissing is returned by Store.Read when no prior snapshot exists
// for the requested (command, site) pair. A fresh first run is not a failure;
// callers handle this case by establishing a new baseline.
var ErrSnapshotMissing = errors.New("gsc state: snapshot missing")

// ErrSchemaVersionMismatch is returned by Store.Read when the on-disk snapshot
// carries a schema_version that this build does not understand. The CLI
// surfaces this as "upgrade ga4-manager or delete the state file to rebaseline";
// auto-migration is deliberately out of scope (see ADR-0005).
var ErrSchemaVersionMismatch = errors.New("gsc state: schema version mismatch")

// ErrInvalidKey is returned when either the command slug or the site identifier
// is empty. Producing a malformed path silently would lead to snapshots that
// cannot be reliably retrieved, so the package fails fast.
var ErrInvalidKey = errors.New("gsc state: command and site must be non-empty")
