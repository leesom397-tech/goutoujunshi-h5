# Web operation simplification — 2026-10-16

Deployed to https://coach.lovetalk.love. Worker version: `91c82d0e-f8ef-482a-92f3-36536176595d`.

## Changes

- Capture next actions now precede the raw records: ask one question or create a full report for the selected batch. Full import and the paid analysis batch remain distinct.
- Remember the material source per owner and person per library; expose changes under Adjust. Person selection remains visible when not associated.
- Group material and cost confirmation together. Selection changes reset consent. No automatic analysis or paid submission.
- Separate raw records/selection from coverage, frequency statistics, voice completion, and cross-device sync controls.
- After complete history import, position the raw-record page at the selected recent batch.
- Carry a bounded, complete excerpt into Ask Chengzi through owner-scoped session storage. Explicitly disclose omitted records, preserve the original conversation, support reload/removal and pending-request recovery, and require confirmation before sending to the existing Qwen endpoint.
- Person overview shows judgement and next step, with existing changes/common points/risk evidence where available. Full reports and compatibility details are under Analysis evidence. Basic information, person comparison, and trends remain accessible.

## Verification

- TypeScript and production build passed.
- Full-history synthetic integration: 1,203 records, continuation, empty incremental import, expired connection, desktop/mobile layout.
- Person overview synthetic checks: 1280/390 widths, all four tabs, report links, no horizontal overflow, no JavaScript errors or write requests.
- Question handoff unit checks: owner/person isolation, complete bounded excerpts, request limits, reload/removal, prior draft preservation, expiry.
- Local and deployed-site browser integration passed: explicit confirmation, consent reset, remembered person, capture-to-question navigation, draft restoration, original conversation preservation, removal persistence, 1280/390 layout.
- Test account/helper APIs were mocked; there were zero real analysis, upload, or paid requests. Results: `outputs/simple-operations-live/result.json` and `outputs/person-overview-merge/result.json`.

## Scope

This release changes the website. It does not publish a new WeChat Mini Program. Person overview uses existing archived statistics and does not invent full-history initiation/frequency figures; full imported-record statistics remain available in the material view. Chat-report risk extraction into the person overview was not added; its existing risk/commonality cards use the saved Moments report.
