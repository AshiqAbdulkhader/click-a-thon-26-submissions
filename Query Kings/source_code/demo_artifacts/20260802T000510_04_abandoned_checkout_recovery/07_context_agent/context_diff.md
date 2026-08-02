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
- channel_effectiveness
- timing_effectiveness
- device_geo_segment_recovery_rate
- overall_recovery_rate

## Context Notes

- Assumes application_id uniquely identifies a checkout attempt
- reminder_sent may occur multiple times per abandonment
- resumed_at_step does not guarantee reconversion
- reconverted event only counts final payment
- events may be missing due to SDK failures

## Registry Status

- Known generated features: 4
- Known columns: 362
- Known workflows: 5
- Known metrics: 26
- Known joins: 100
- Known context contradictions / gaps / known-issue links: 8

## Open Contradictions & Gaps (sample)

- `base_context_eta_name_mismatch`: Base context mentions visa_issuance_eta_days, while the loaded application_started DDL exposes eta_shown.
- `conversion_denominator_ambiguity`: Base context defines leadership conversion as purchases divided by sessions, but funnel conversion as purchases divided by application_started users.
- `gap:abandoned_checkout_recovery:orphan_metric_overall_recovery_rate`: Metric hint "overall_recovery_rate" does not clearly map to any generated column name; analytics should treat the formula as approximate.
- `gap:abandoned_checkout_recovery:orphan_metric_timing_effectiveness`: Metric hint "timing_effectiveness" does not clearly map to any generated column name; analytics should treat the formula as approximate.
- `known_issue_link:abandoned_checkout_recovery:k1_ios_webkit_otp`: Feature abandoned_checkout_recovery touches payment/OTP/checkout flows. Analytics should cut by iOS/device and check against known issue K1 (iOS WebKit OTP autofill regression).
- `known_issue_link:abandoned_checkout_recovery:k5_whatsapp_nudge`: Feature abandoned_checkout_recovery relates to recovery/re-engagement. Context notes K5 WhatsApp nudge can lift returns for previously dropped users — separate campaign lift from product changes.
- `known_issue_link:express_checkout:k1_ios_webkit_otp`: Feature express_checkout touches payment/OTP/checkout flows. Analytics should cut by iOS/device and check against known issue K1 (iOS WebKit OTP autofill regression).
- `known_issue_link:express_checkout:k6_summer20`: Feature express_checkout may interact with promo/currency behaviour. K6 SUMMER20 campaign elevates coupon_applied and can lower realised value — do not treat value drops as pure product regressions without checking coupons.
