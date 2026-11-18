package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const minimalConfig = "project:\n  name: Site\nga4:\n  property_id: \"123456789\"\n"

func TestLoadConfigByName_UsesConfigDirEnvAndListsSearchedDirs(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "mysite.yaml"), []byte(minimalConfig), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv(ConfigDirEnv, dir)
	t.Chdir(t.TempDir()) // a working directory with no configs/, like Claude Desktop's "/"

	cfg, err := LoadConfigByName("mysite")
	if err != nil || cfg.Project.Name != "Site" {
		t.Fatalf("cfg=%v err=%v", cfg, err)
	}
	_, err = LoadConfigByName("missing")
	if err == nil || !strings.Contains(err.Error(), dir) || !strings.Contains(err.Error(), ConfigDirEnv) {
		t.Fatalf("error should list searched dirs and the env var: %v", err)
	}
}

func TestLoadConfigByName_OperatorConfigBeatsExample(t *testing.T) {
	root := t.TempDir()
	t.Chdir(root)
	t.Setenv(ConfigDirEnv, "")
	if err := os.MkdirAll(filepath.Join("configs", "examples"), 0o755); err != nil {
		t.Fatal(err)
	}
	example := strings.Replace(minimalConfig, "Site", "Example", 1)
	if err := os.WriteFile(filepath.Join("configs", "examples", "same.yaml"), []byte(example), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join("configs", "same.yaml"), []byte(minimalConfig), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := LoadConfigByName("same")
	if err != nil || cfg.Project.Name != "Site" {
		t.Fatalf("operator config should win: cfg=%v err=%v", cfg, err)
	}
	names, _ := ListAvailableConfigs()
	if len(names) != 1 || names[0] != "same" {
		t.Fatalf("names = %v", names)
	}
}

func TestLoadConfigByName_AcceptsAPath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "anywhere.yaml")
	if err := os.WriteFile(path, []byte(minimalConfig), 0o600); err != nil {
		t.Fatal(err)
	}
	if cfg, err := LoadConfigByName(path); err != nil || cfg.Project.Name != "Site" {
		t.Fatalf("cfg=%v err=%v", cfg, err)
	}
}
