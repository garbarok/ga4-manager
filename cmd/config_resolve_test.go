package cmd

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWriteResolvedConfigs_SingleConfig(t *testing.T) {
	var out, errOut bytes.Buffer
	path := filepath.Join("..", "testdata", "valid_project.yaml")
	require.NoError(t, writeResolvedConfigs(&out, &errOut, []string{path}, true))

	var got []ResolvedConfig
	require.NoError(t, json.Unmarshal(out.Bytes(), &got))
	require.Len(t, got, 1)
	assert.Equal(t, "Test Project", got[0].Project)
	assert.Equal(t, "123456789", got[0].PropertyID)
	assert.Equal(t, path, got[0].Path)
	assert.NotNil(t, got[0].HreflangPairs, "hreflang_pairs is always an array, never null")
}

func TestWriteResolvedConfigs_StrictFailsOnBadConfig(t *testing.T) {
	var out, errOut bytes.Buffer
	err := writeResolvedConfigs(&out, &errOut, []string{"does-not-exist.yaml"}, true)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to load config")
}

func TestWriteResolvedConfigs_AllSkipsBrokenConfigs(t *testing.T) {
	var out, errOut bytes.Buffer
	paths := []string{
		filepath.Join("..", "testdata", "valid_project.yaml"),
		"does-not-exist.yaml",
	}
	require.NoError(t, writeResolvedConfigs(&out, &errOut, paths, false))

	var got []ResolvedConfig
	require.NoError(t, json.Unmarshal(out.Bytes(), &got))
	assert.Len(t, got, 1)
	assert.Contains(t, errOut.String(), "skipping does-not-exist.yaml")
}

func TestWriteResolvedConfigs_GSCAndHreflang(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "site.yaml")
	require.NoError(t, os.WriteFile(path, []byte(`
project:
  name: Site
ga4:
  property_id: "42"
search_console:
  site_url: "sc-domain:example.com"
  hreflang_pairs:
    - en: "https://www.example.com/a"
      es: "https://www.example.com/es/a"
`), 0o600))

	var out, errOut bytes.Buffer
	require.NoError(t, writeResolvedConfigs(&out, &errOut, []string{path}, true))
	var got []ResolvedConfig
	require.NoError(t, json.Unmarshal(out.Bytes(), &got))
	assert.Equal(t, "sc-domain:example.com", got[0].GSCSite)
	assert.Equal(t, "https://www.example.com/es/a", got[0].HreflangPairs[0]["es"])
}

func TestOperatorConfigPaths_ExcludesExamples(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "examples"), 0o755))
	for _, f := range []string{"b.yaml", "a.yaml", "examples/template.yaml", "notes.md"} {
		require.NoError(t, os.WriteFile(filepath.Join(dir, f), []byte("x"), 0o600))
	}
	got, err := operatorConfigPaths(dir)
	require.NoError(t, err)
	assert.Equal(t, []string{filepath.Join(dir, "a.yaml"), filepath.Join(dir, "b.yaml")}, got)
}
