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
- Add vs remove churn per group (traveller_added vs traveller_removed)
- Per‑traveller docs_complete bottleneck for large groups
- Destination or segment distribution of group applications

## Context Notes

- traveller_removed events are rare and may skew churn metrics
- docs_complete flag only present on traveller_added events
- group_size field is static per group, but travellers_submitted may differ if removals occur

## Registry Status

- Known generated features: 2
- Known columns: 324
- Known workflows: 3
- Known metrics: 13
- Known joins: 100
- Known context contradictions / gaps / known-issue links: 4

## Open Contradictions & Gaps (sample)

- `base_context_eta_name_mismatch`: Base context mentions visa_issuance_eta_days, while the loaded application_started DDL exposes eta_shown.
- `conversion_denominator_ambiguity`: Base context defines leadership conversion as purchases divided by sessions, but funnel conversion as purchases divided by application_started users.
- `known_issue_link:express_checkout:k1_ios_webkit_otp`: Feature express_checkout touches payment/OTP/checkout flows. Analytics should cut by iOS/device and check against known issue K1 (iOS WebKit OTP autofill regression).
- `known_issue_link:express_checkout:k6_summer20`: Feature express_checkout may interact with promo/currency behaviour. K6 SUMMER20 campaign elevates coupon_applied and can lower realised value — do not treat value drops as pure product regressions without checking coupons.
