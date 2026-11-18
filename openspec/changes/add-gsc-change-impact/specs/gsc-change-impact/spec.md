# Spec Delta

## ADDED Requirements

### Requirement: Equal windows around the change, lag-safe
For each change, `gsc_change_impact` SHALL compare an after window `[changed_on+1, changed_on+N]` with a before window `[changed_on−N, changed_on−1]`. N = min(window_days, data_through − changed_on). The change day SHALL be in neither window. The result SHALL report N as `days_per_window`, both windows, and `data_through`.

#### Scenario: Recent change
- **WHEN** a change was 10 days before data_through and window_days is 28
- **THEN** both windows are 10 days long and the after window ends at data_through

### Requirement: Scoped metrics
A change with `url` SHALL be measured on that page (equals filter). A change with `prefix` SHALL be measured on pages matching it (a regex prefix; a bare `/path` matches any host). A change with neither SHALL be measured on the whole site. Position SHALL be impression-weighted over the window.

#### Scenario: Path prefix on a domain property
- **WHEN** the prefix is `/blog/` on `sc-domain:example.com`
- **THEN** pages on www.example.com/blog/… and example.com/blog/… are both counted

### Requirement: Verdict with visible thresholds
The verdict SHALL be `too_early` when N < min_days or when total impressions < min_impressions. Otherwise:
- `improved` / `worse` when clicks changed by at least ±clicks_threshold_pct (with prior clicks > 0);
- else `improved` / `worse` when position moved by at least ±position_threshold;
- else `flat`.

The thresholds used and a reason sentence SHALL be returned.

#### Scenario: Clicks flat, position up
- **WHEN** clicks changed +5% and position improved by 1.5
- **THEN** the verdict is `improved` with a reason naming the position move

### Requirement: Changes from GA4 annotations
With `from_annotations`, user-created (not system-generated) GA4 annotations SHALL become changes dated on their (start) date and labelled with their title. Overlapping changes SHALL be listed per change, with a warning.

#### Scenario: System annotation
- **WHEN** GA4 lists a system-generated annotation
- **THEN** it is not evaluated
