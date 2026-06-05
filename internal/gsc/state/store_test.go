package state

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStore_WriteThenRead_RoundTrip(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)
	ctx := context.Background()

	payload := json.RawMessage(`{"deindexed":["/a","/b"],"covered":42}`)
	require.NoError(t, store.Write(ctx, "health", "sc-domain:example.com", payload))

	snap, err := store.Read(ctx, "health", "sc-domain:example.com")
	require.NoError(t, err)

	assert.Equal(t, SchemaVersion, snap.SchemaVersion)
	assert.Equal(t, "health", snap.Command)
	assert.Equal(t, "sc-domain:example.com", snap.Site)
	assert.JSONEq(t, string(payload), string(snap.Data))
	assert.False(t, snap.GeneratedAt.IsZero(), "GeneratedAt must be populated on write")
}

func TestStore_Read_MissingSnapshot_ReturnsTypedError(t *testing.T) {
	store := NewStore(t.TempDir())

	_, err := store.Read(context.Background(), "health", "sc-domain:example.com")

	require.Error(t, err)
	assert.ErrorIs(t, err, ErrSnapshotMissing)
}

func TestStore_Read_MissingDir_ReturnsTypedError(t *testing.T) {
	// A non-existent state directory must surface as ErrSnapshotMissing too,
	// so first-run consumers do not have to special-case "no directory yet".
	store := NewStore(filepath.Join(t.TempDir(), "does-not-exist"))

	_, err := store.Read(context.Background(), "health", "sc-domain:example.com")

	require.Error(t, err)
	assert.ErrorIs(t, err, ErrSnapshotMissing)
}

func TestStore_Read_SchemaVersionMismatch(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	// Hand-write a snapshot with a version this build does not understand.
	future := Snapshot{
		SchemaVersion: SchemaVersion + 99,
		Command:       "health",
		Site:          "sc-domain:example.com",
		Data:          json.RawMessage(`{}`),
	}
	bytes, err := json.Marshal(future)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(store.pathFor("health", "sc-domain:example.com"), bytes, 0o644))

	_, err = store.Read(context.Background(), "health", "sc-domain:example.com")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrSchemaVersionMismatch)
}

func TestStore_Read_MalformedJSON_PropagatesAsGenericError(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)
	require.NoError(t, os.WriteFile(store.pathFor("health", "sc-domain:example.com"), []byte("{not json"), 0o644))

	_, err := store.Read(context.Background(), "health", "sc-domain:example.com")
	require.Error(t, err)
	assert.NotErrorIs(t, err, ErrSnapshotMissing)
	assert.NotErrorIs(t, err, ErrSchemaVersionMismatch)
}

func TestStore_Write_AtomicRename_PriorFileIntactOnFailure(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)
	ctx := context.Background()

	// Establish a baseline snapshot we can later assert is untouched.
	baseline := json.RawMessage(`{"value":"baseline"}`)
	require.NoError(t, store.Write(ctx, "health", "sc-domain:example.com", baseline))
	baselineBytes, err := os.ReadFile(store.pathFor("health", "sc-domain:example.com"))
	require.NoError(t, err)

	// Inject a rename failure to simulate an interrupted write after the temp
	// file has been created and synced but before it has replaced the prior
	// snapshot.
	injected := errors.New("simulated rename failure")
	store.renameFn = func(string, string) error { return injected }

	err = store.Write(ctx, "health", "sc-domain:example.com", json.RawMessage(`{"value":"new"}`))
	require.Error(t, err)
	assert.ErrorIs(t, err, injected)

	// Prior snapshot must still be readable and byte-for-byte identical.
	after, err := os.ReadFile(store.pathFor("health", "sc-domain:example.com"))
	require.NoError(t, err)
	assert.Equal(t, baselineBytes, after, "baseline snapshot must not be mutated by a failed write")

	// And the orphaned temp file must have been cleaned up.
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	for _, e := range entries {
		assert.NotContains(t, e.Name(), ".tmp-", "orphaned temp file leaked: %s", e.Name())
	}
}

func TestStore_Write_TempFileLivesInDestinationDir(t *testing.T) {
	// Cross-device renames are not guaranteed atomic and may fail outright; the
	// implementation must keep the temp file inside the destination directory.
	dir := t.TempDir()
	store := NewStore(dir)

	var capturedOld string
	store.renameFn = func(oldpath, newpath string) error {
		capturedOld = oldpath
		return os.Rename(oldpath, newpath)
	}

	require.NoError(t, store.Write(context.Background(), "health", "sc-domain:example.com", json.RawMessage(`{}`)))
	assert.Equal(t, dir, filepath.Dir(capturedOld), "temp file must live alongside the destination")
}

func TestStore_WriteRead_EmptyKeyRejected(t *testing.T) {
	store := NewStore(t.TempDir())
	ctx := context.Background()

	cases := []struct {
		name    string
		command string
		site    string
	}{
		{"empty command", "", "sc-domain:example.com"},
		{"empty site", "health", ""},
		{"both empty", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name+"/write", func(t *testing.T) {
			err := store.Write(ctx, tc.command, tc.site, json.RawMessage(`{}`))
			require.Error(t, err)
			assert.ErrorIs(t, err, ErrInvalidKey)
		})
		t.Run(tc.name+"/read", func(t *testing.T) {
			_, err := store.Read(ctx, tc.command, tc.site)
			require.Error(t, err)
			assert.ErrorIs(t, err, ErrInvalidKey)
		})
	}
}

func TestStore_PathFor_SafeSiteReplacement(t *testing.T) {
	store := NewStore("/state")

	cases := []struct {
		name string
		site string
		want string
	}{
		{
			name: "domain property colon replaced",
			site: "sc-domain:example.com",
			want: filepath.Join("/state", "health.sc-domain_example.com.json"),
		},
		{
			name: "url-prefix property slashes replaced",
			site: "https://example.com/",
			want: filepath.Join("/state", "health.https___example.com_.json"),
		},
		{
			name: "backslash replaced",
			site: `weird\site`,
			want: filepath.Join("/state", "health.weird_site.json"),
		},
		{
			name: "plain site untouched",
			site: "example.com",
			want: filepath.Join("/state", "health.example.com.json"),
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, store.pathFor("health", tc.site))
		})
	}
}

func TestResolveStateDir(t *testing.T) {
	cases := []struct {
		name string
		flag string
		want string
	}{
		{"empty falls back to default", "", ".ga4-state"},
		{"non-empty returned verbatim", "/var/lib/ga4-state", "/var/lib/ga4-state"},
		{"relative non-empty returned verbatim", "custom-state", "custom-state"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, ResolveStateDir(tc.flag))
		})
	}
}
