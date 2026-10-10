# 1.0.66 — relationship workflow repair

## Implemented

- Persisted background jobs for profile screenshots and ordered chat batches (up to 9 images). Internal app dispatch replaces public self-fetch. Payloads and temporary authorization are removed on terminal completion; results expire after 24 hours.
- Task IDs survive page recreation. Plain text upstream errors are converted to readable messages.
- Explicit person routing; normal screenshot entry no longer inherits a globally selected person.
- Separate personal/person sections, consistent icons, readable profile tiles, compatibility radar, interaction radar and trend line.
- Fix confirmed person fields written as city/etc. but read as subjectBasic:city/etc.; project recognizable accepted legacy facts into their corresponding fields.
- Shared six-dimensional compatibility, evidence, common points and actionable conclusions across profile analysis, person details and chat reports.
- Store interaction summaries in the selected person's archive so expiring raw reports do not erase future trend history. Deduplicate content fingerprints. Keep at most 120 archived summaries per person; chart shows latest 8 distinct materials, not a count of dates or meetings.
- A single confirmation section above profile content. Context fields may be imported and confirmed alongside basic fields.
- Preserve the knowledge library and its verified counts (46 references, 76,735 Han characters).

## Verification

- TypeScript check, native Mini Program regression, release static checks.
- Background-job restart, idempotent submission, nine-image ordering, payload cleanup and non-JSON 522 tests.
- WeChat WXML compiler and actual own/person navigation.
- Production synthetic profile job: HTTP 202 accepted, navigated away, HTTP 200 done with result while on archive page.

## Boundaries

- Scores are transparent comparison heuristics, not validated predictions of a person's worth or probability of success.
- Unknown axes remain explicitly unknown; the radar frame remains visible, with known points only when data is partial.
- Trend timestamps without an explicit chat timestamp are record dates, not inferred dates of real interactions.
- Recognition cannot recover missing originals or information never extracted. Legacy projection only uses already accepted, clearly labeled facts.
- Mobile lock-screen/network interruptions and 9 dense real screenshots still require device verification.
- The temporary QR is a preview; an uploaded development build is not automatically approved or formally published.
