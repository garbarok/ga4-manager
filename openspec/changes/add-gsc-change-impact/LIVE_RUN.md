# Live dry run (2026-11-18)

A real Search Console domain property and its GA4 property. Site names, URLs and absolute click counts are left out.

Run: `ga4m gsc-change-impact --config <live> --from-annotations --changes '[three manual changes]'`. `data_through` was 3 days before the run.

| Change | Source | Scope | Days/window | Verdict | Why |
|--------|--------|-------|-------------|---------|-----|
| 33 days before data_through | manual | site | 28 | improved | clicks +229% |
| 26 days before | manual | path prefix | 26 | improved | clicks +290% |
| 2 days before | manual | site | 2 | too_early | 2 days < 7 |
| 18 days before | GA4 annotation | site | 18 | improved | clicks +82.5% |
| 17 days before | GA4 annotation (path in text) | path prefix | 17 | improved | clicks +42.9%, position −0.77 |

The tool warned that the changes overlap, since they sit inside each other's windows. Quota: 9 GSC queries, which is 1 + 2 × 4 evaluated changes; the too-early change makes no queries.

**Finding from this run, fixed:** the annotation's `/path` was first turned into an apex-host prefix and matched 0 impressions, because the site is served from `www.`. A bare path now matches any host of the property.
