# Proposal

## Why

The question after any SEO change is "did it work?". `gsc_traffic_compare` compares two arbitrary windows, but the agent has to pick them. Agents tend to make three mistakes: windows of unequal length, the change day counted on one side, and an "after" window that runs into Search Console's 2–3 day lag. That lag then reads as a drop. OpenSEO has no equivalent.

## What Changes

New tool `gsc_change_impact` (CLI: `ga4m gsc-change-impact`).

- **Input:** `changes` [{url | prefix | neither (whole site), changed_on, label}], and/or `from_annotations: true`, which reads user-created GA4 annotations. A URL or `/path` in an annotation's title or description scopes it. A bare `/path` prefix matches any host of the property.
- **Windows:** two equal windows of up to `window_days` (default 28). The change day is in neither. The after window ends at `data_through`, and both windows shrink to the days available.
- **Output per change:**
  - before and after clicks, impressions, CTR and impression-weighted position;
  - deltas (clicks %, impressions %, CTR in percentage points, position, where positive = worse);
  - `days_per_window` and both windows;
  - overlapping changes;
  - a verdict, with the reason.
- **Verdicts:**
  - `too_early`: fewer than `min_days` (7) days after the change, or fewer than `min_impressions` (100) across both windows.
  - Otherwise clicks decide first (±`clicks_threshold_pct`, 10%). When clicks moved less, position decides (±`position_threshold`, 1). The result is `improved`, `worse` or `flat`.
- The thresholds and the method notes are returned with every result.

## Capabilities

### New Capabilities
- `gsc-change-impact`

## Impact

- New: `mcp/src/tools/gsc-change-impact.ts`, `mcp/src/utils/gsc-query.ts` (Search Analytics with dimension filters).
- Reads GA4 annotations through the existing `ga4_annotations` list path.
- Quota: 1 GSC query plus 2 per evaluated change.
