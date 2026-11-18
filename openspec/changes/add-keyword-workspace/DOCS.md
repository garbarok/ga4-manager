# Docs to merge

> Merged into README.md, mcp/README.md, CHANGELOG.md and mcp/CHANGELOG.md on 2026-11-18. Kept as the change's record.

## README tool table (rows)

| Keyword workspace | `keywords_save`, `keywords_list`, `keywords_remove`, `keyword_suggestions` |
| Competitive research | `serp_competitors`, `domain_overview`, `serp_locations` |

## CHANGELOG (Added)

- **Keyword workspace** (`keywords_save`, `keywords_list`, `keywords_remove`): saved, tagged keyword lists per site in `.ga4-state/`, with optional stored metrics so bought data is reused.
- **`keyword_suggestions`**: Search Console queries at positions 4–30 not yet saved (free), plus optional DataForSEO `keywords_for_site` behind the cost gate.
- **`serp_competitors`**: the domains ranking most across a keyword set or saved tag, with share of keywords, positions and visibility; marks your site and known competitors and suggests new ones.
- **`serp_locations`**: free lookup of DataForSEO location and language codes, including regions and cities.
- **`domain_overview`**: a domain's estimated organic traffic, keyword counts by position band and top pages (DataForSEO Labs, gated).
