package cmd

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/spf13/cobra"
)

func TestNeedsCredentials(t *testing.T) {
	tests := []struct {
		name string
		want bool
	}{
		{"help", false},
		{"completion", false},
		{cobra.ShellCompRequestCmd, false},
		{cobra.ShellCompNoDescRequestCmd, false},
		{"report", true},
		{"setup", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := needsCredentials(&cobra.Command{Use: tt.name}); got != tt.want {
				t.Errorf("needsCredentials(%q) = %v, want %v", tt.name, got, tt.want)
			}
		})
	}
}

// Running any command must not scaffold configs/ in the working directory:
// the MCP server runs ga4 from the user's project folder.
func TestRootDoesNotCreateConfigsDir(t *testing.T) {
	dir := t.TempDir()
	t.Chdir(dir)
	t.Setenv("GOOGLE_APPLICATION_CREDENTIALS", "")

	for _, args := range [][]string{{"--version"}, {"help"}} {
		rootCmd.SetArgs(args)
		rootCmd.SetOut(new(discard))
		rootCmd.SetErr(new(discard))
		if err := rootCmd.Execute(); err != nil {
			t.Fatalf("ga4 %v: %v", args, err)
		}
	}
	rootCmd.SetArgs(nil)

	if _, err := os.Stat(filepath.Join(dir, "configs")); !os.IsNotExist(err) {
		t.Fatalf("configs/ was created in the working directory (stat err: %v)", err)
	}
}

type discard struct{}

func (*discard) Write(p []byte) (int, error) { return len(p), nil }
