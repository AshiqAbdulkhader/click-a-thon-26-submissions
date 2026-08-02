# Context Diff

## Added Feature

- Feature: Group / Family Applications
- Slug: `group_family`
- Table: `silver.group_family_events`
- Primary entity: `group_id`
- Workflow type: `funnel`
- Events: `group_started` -> `traveller_added` -> `traveller_removed` -> `group_submitted`
- Success event: `group_submitted`

## Metric Hints

- Completion rate (group_started → group_submitted) by group size
- Add/remove churn: travellers added vs removed per group
- Per-traveller document completion bottleneck for large groups
- Destinations/segments driving group applications

## Context Notes

- group_started includes group_size and destination
- traveller_added carries docs_complete boolean
- group_submitted includes travellers_submitted count
- group_removed events are rare (70 vs 3495 added)
- group_submitted count (688) lower than group_started (1200) indicates drop‑off
- group_id is the primary grain for all events

## Registry Status

- Known generated features: 2
- Known columns: 321
- Known workflows: 3
- Known metrics: 13
- Known joins: 100
- Known context contradictions / gaps / known-issue links: 5

## Open Contradictions & Gaps (sample)

- `base_context_eta_name_mismatch`: Base context mentions visa_issuance_eta_days, while the loaded application_started DDL exposes eta_shown.
- `conversion_denominator_ambiguity`: Base context defines leadership conversion as purchases divided by sessions, but funnel conversion as purchases divided by application_started users.
- `known_issue_link:express_checkout:k1_ios_webkit_otp`: Feature express_checkout touches payment/OTP/checkout flows. Analytics should cut by iOS/device and check against known issue K1 (iOS WebKit OTP autofill regression).
- `known_issue_link:express_checkout:k6_summer20`: Feature express_checkout may interact with promo/currency behaviour. K6 SUMMER20 campaign elevates coupon_applied and can lower realised value — do not treat value drops as pure product regressions without checking coupons.
- `known_issue_link:group_family:k2_k3_passport`: Feature group_family relates to document/passport capture. Watch K2 (Android capture failures after model update) and K3 (non-Latin MRZ OCR retries).
