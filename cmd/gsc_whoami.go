package cmd

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/fatih/color"
	"github.com/spf13/cobra"

	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/garbarok/ga4-manager/internal/gsc"
)

var (
	gscWhoamiSite   string
	gscWhoamiConfig string
	gscWhoamiFormat string
)

var gscWhoamiCmd = &cobra.Command{
	Use:   "whoami",
	Short: "Show the authenticated identity and per-property permissions",
	Long: `Report which account ga4-manager is authenticating as and what it is allowed
to do on Google Search Console.

It prints:
  - the service-account email and GCP project behind GOOGLE_APPLICATION_CREDENTIALS
  - each accessible property and its permission level
  - whether that permission allows write operations (sitemap submit/delete)

Permission levels (from the GSC sites API):
  siteOwner, siteFullUser        → read + write
  siteRestrictedUser             → read-only (sitemap submit/delete will 403)
  siteUnverifiedUser             → no access

Use this first when a write command returns "403: User does not have sufficient
permission" — it tells you up front whether the account can write at all.

Examples:
  # All accessible properties
  ga4 gsc whoami

  # A specific property
  ga4 gsc whoami --site sc-domain:example.com

  # From a config file (uses search_console.site_url)
  ga4 gsc whoami --config configs/mysite.yaml

  # JSON for automation
  ga4 gsc whoami --format json`,
	RunE: runGSCWhoami,
}

func init() {
	gscCmd.AddCommand(gscWhoamiCmd)
	gscWhoamiCmd.Flags().StringVarP(&gscWhoamiSite, "site", "s", "", "Site URL to check (sc-domain:example.com or https://example.com/)")
	gscWhoamiCmd.Flags().StringVarP(&gscWhoamiConfig, "config", "c", "", "Path to configuration file (uses search_console.site_url)")
	gscWhoamiCmd.Flags().StringVarP(&gscWhoamiFormat, "format", "f", "table", "Output format: table or json")
}

type whoamiReport struct {
	ClientEmail    string               `json:"client_email"`
	ProjectID      string               `json:"project_id"`
	CredentialPath string               `json:"credential_path"`
	Sites          []gsc.SitePermission `json:"sites"`
}

func runGSCWhoami(cmd *cobra.Command, args []string) error {
	site := gscWhoamiSite
	if site == "" && gscWhoamiConfig != "" {
		cfg, err := config.LoadConfig(gscWhoamiConfig)
		if err != nil {
			color.Red("✗ Failed to load config: %v", err)
			return err
		}
		if cfg.SearchConsole == nil || cfg.SearchConsole.SiteURL == "" {
			return fmt.Errorf("no search_console.site_url found in %s", gscWhoamiConfig)
		}
		site = cfg.SearchConsole.SiteURL
	}

	id := gsc.LoadServiceAccountIdentity()

	client, err := gsc.NewClient()
	if err != nil {
		color.Red("✗ Failed to create GSC client: %v", err)
		return err
	}
	defer func() { _ = client.Close() }()

	var sites []gsc.SitePermission
	if site != "" {
		perm, err := client.GetSitePermission(site)
		if err != nil {
			color.Red("✗ Failed to read permission for %s: %v", site, err)
			return err
		}
		sites = []gsc.SitePermission{*perm}
	} else {
		sites, err = client.ListSitePermissions()
		if err != nil {
			color.Red("✗ Failed to list accessible properties: %v", err)
			return err
		}
	}

	report := whoamiReport{
		ClientEmail:    id.ClientEmail,
		ProjectID:      id.ProjectID,
		CredentialPath: id.CredentialPath,
		Sites:          sites,
	}

	if gscWhoamiFormat == "json" {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(report)
	}

	displayWhoamiTable(report)
	return nil
}

func displayWhoamiTable(r whoamiReport) {
	color.Cyan("═══ Authenticated Identity ═══")
	fmt.Printf("Service account: %s\n", orUnknownValue(r.ClientEmail))
	fmt.Printf("GCP project:     %s\n", orUnknownValue(r.ProjectID))
	fmt.Printf("Credentials:     %s\n", orUnknownValue(r.CredentialPath))
	fmt.Println()

	color.Cyan("═══ Property Permissions ═══")
	if len(r.Sites) == 0 {
		color.Yellow("No accessible properties found for this account.")
		return
	}
	for _, s := range r.Sites {
		if s.CanWrite {
			color.Green("✓ %s", s.SiteURL)
			fmt.Printf("    %s — read + write (sitemap submit/delete allowed)\n", s.PermissionLevel)
		} else {
			color.Yellow("○ %s", s.SiteURL)
			fmt.Printf("    %s — read-only (sitemap submit/delete will 403)\n", s.PermissionLevel)
		}
	}
}

func orUnknownValue(s string) string {
	if s == "" {
		return "(unknown)"
	}
	return s
}
