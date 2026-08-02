# Context Diff

## Added Feature

- Feature: Visa Status Sharing
- Slug: `status_sharing`
- Table: `silver.status_sharing_events`
- Primary entity: `share_id`
- Workflow type: `referral_loop`
- Events: `share_clicked` -> `channel_selected` -> `link_generated` -> `link_opened` -> `recipient_cta_clicked`
- Success event: `recipient_cta_clicked`

## Metric Hints

- Share rate by status_shared
- Channel mix for new-user opens
- Recipient conversion rate (opens to CTA) for new users
- Destination spread of shares

## Context Notes

- Recipient events keyed by share_id; join on share_id
- link_opened may include non-new users; filter by recipient_is_new_user
- status_shared only present in sharer events

## Registry Status

- Known generated features: 3
- Known columns: 341
- Known workflows: 4
- Known metrics: 18
- Known joins: 100
- Known context contradictions / gaps / known-issue links: 5

## Open Contradictions & Gaps (sample)

- `base_context_eta_name_mismatch`: Base context mentions visa_issuance_eta_days, while the loaded application_started DDL exposes eta_shown.
- `conversion_denominator_ambiguity`: Base context defines leadership conversion as purchases divided by sessions, but funnel conversion as purchases divided by application_started users.
- `known_issue_link:express_checkout:k1_ios_webkit_otp`: Feature express_checkout touches payment/OTP/checkout flows. Analytics should cut by iOS/device and check against known issue K1 (iOS WebKit OTP autofill regression).
- `known_issue_link:express_checkout:k6_summer20`: Feature express_checkout may interact with promo/currency behaviour. K6 SUMMER20 campaign elevates coupon_applied and can lower realised value — do not treat value drops as pure product regressions without checking coupons.
- `known_issue_link:group_family:k2_k3_passport`: Feature group_family relates to document/passport capture. Watch K2 (Android capture failures after model update) and K3 (non-Latin MRZ OCR retries).
