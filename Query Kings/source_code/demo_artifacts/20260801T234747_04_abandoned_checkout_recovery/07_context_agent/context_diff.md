# Context Diff

## Added Feature

- Feature: Abandoned Checkout Recovery
- Slug: `abandoned_checkout_recovery`
- Table: `silver.abandoned_checkout_recovery_events`
- Primary entity: `application_id`
- Workflow type: `recovery`
- Events: `abandonment_detected` -> `reminder_sent` -> `reminder_opened` -> `reminder_cta_clicked` -> `resumed_at_step` -> `reconverted`
- Success event: `reconverted`

## Metric Hints

- reconversion_rate_by_drop_step
- channel_effectiveness_open_click_reconvert
- timing_effect_on_reconversion
- segment_cuts_by_device_geo_destination

## Context Notes

- channel field may be null for some events
- hours_since_drop only present for reminder_sent
- resumed_at_step may not always precede reconverted
- backfilled rows may duplicate events

## Registry Status

- Known generated features: 4
- Known columns: 359
- Known workflows: 5
- Known metrics: 23
- Known joins: 100
- Known context contradictions / gaps / known-issue links: 7

## Open Contradictions & Gaps (sample)

- `base_context_eta_name_mismatch`: Base context mentions visa_issuance_eta_days, while the loaded application_started DDL exposes eta_shown.
- `conversion_denominator_ambiguity`: Base context defines leadership conversion as purchases divided by sessions, but funnel conversion as purchases divided by application_started users.
- `known_issue_link:abandoned_checkout_recovery:k1_ios_webkit_otp`: Feature abandoned_checkout_recovery touches payment/OTP/checkout flows. Analytics should cut by iOS/device and check against known issue K1 (iOS WebKit OTP autofill regression).
- `known_issue_link:abandoned_checkout_recovery:k5_whatsapp_nudge`: Feature abandoned_checkout_recovery relates to recovery/re-engagement. Context notes K5 WhatsApp nudge can lift returns for previously dropped users — separate campaign lift from product changes.
- `known_issue_link:express_checkout:k1_ios_webkit_otp`: Feature express_checkout touches payment/OTP/checkout flows. Analytics should cut by iOS/device and check against known issue K1 (iOS WebKit OTP autofill regression).
- `known_issue_link:express_checkout:k6_summer20`: Feature express_checkout may interact with promo/currency behaviour. K6 SUMMER20 campaign elevates coupon_applied and can lower realised value — do not treat value drops as pure product regressions without checking coupons.
- `known_issue_link:group_family:k2_k3_passport`: Feature group_family relates to document/passport capture. Watch K2 (Android capture failures after model update) and K3 (non-Latin MRZ OCR retries).
