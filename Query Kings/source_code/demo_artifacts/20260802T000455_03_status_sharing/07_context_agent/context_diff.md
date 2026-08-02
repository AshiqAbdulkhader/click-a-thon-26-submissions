# Context Diff

## Added Feature

- Feature: Visa Status Sharing
- Slug: `status_sharing`
- Table: `silver.status_sharing_events`
- Primary entity: `share_id`
- Workflow type: `funnel`
- Events: `share_clicked` -> `channel_selected` -> `link_generated` -> `link_opened` -> `recipient_cta_clicked`
- Success event: `recipient_cta_clicked`

## Metric Hints

- share_rate
- share_rate_by_status_shared
- channel_mix
- new_user_link_opens
- recipient_conversion_rate
- destination_spread

## Context Notes

- share_id is the primary grain; recipient events keyed by share_id
- link_opened may include non-new users; recipient_cta_clicked only for new users
- event counts show some shares lack channel_selected; consider missing data

## Registry Status

- Known generated features: 3
- Known columns: 344
- Known workflows: 4
- Known metrics: 20
- Known joins: 100
- Known context contradictions / gaps / known-issue links: 4

## Open Contradictions & Gaps (sample)

- `base_context_eta_name_mismatch`: Base context mentions visa_issuance_eta_days, while the loaded application_started DDL exposes eta_shown.
- `conversion_denominator_ambiguity`: Base context defines leadership conversion as purchases divided by sessions, but funnel conversion as purchases divided by application_started users.
- `known_issue_link:express_checkout:k1_ios_webkit_otp`: Feature express_checkout touches payment/OTP/checkout flows. Analytics should cut by iOS/device and check against known issue K1 (iOS WebKit OTP autofill regression).
- `known_issue_link:express_checkout:k6_summer20`: Feature express_checkout may interact with promo/currency behaviour. K6 SUMMER20 campaign elevates coupon_applied and can lower realised value — do not treat value drops as pure product regressions without checking coupons.
