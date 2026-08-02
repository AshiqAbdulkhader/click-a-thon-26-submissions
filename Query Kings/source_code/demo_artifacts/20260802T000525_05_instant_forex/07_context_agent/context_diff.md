# Context Diff

## Added Feature

- Feature: Instant Forex Add-on
- Slug: `instant_forex`
- Table: `silver.instant_forex_events`
- Primary entity: `application_id`
- Workflow type: `revenue_addon`
- Events: `forex_offer_shown` -> `currency_selected` -> `amount_entered` -> `forex_added_to_cart` -> `forex_purchased`
- Success event: `forex_purchased`

## Metric Hints

- attach_rate_overall
- attach_rate_by_destination
- aov_uplift_distribution
- drop_off_offer_to_amount
- drop_off_cart_to_purchased
- best_attach_destinations
- best_attach_currencies
- segment_skew

## Context Notes

- Event counts show significant drop-offs; verify data completeness.
- Currency selection may be optional; some users skip to amount entry.
- Device_type values vary across platforms; consider normalizing.

## Registry Status

- Known generated features: 5
- Known columns: 382
- Known workflows: 6
- Known metrics: 35
- Known joins: 100
- Known context contradictions / gaps / known-issue links: 14

## Open Contradictions & Gaps (sample)

- `base_context_eta_name_mismatch`: Base context mentions visa_issuance_eta_days, while the loaded application_started DDL exposes eta_shown.
- `conversion_denominator_ambiguity`: Base context defines leadership conversion as purchases divided by sessions, but funnel conversion as purchases divided by application_started users.
- `gap:abandoned_checkout_recovery:orphan_metric_overall_recovery_rate`: Metric hint "overall_recovery_rate" does not clearly map to any generated column name; analytics should treat the formula as approximate.
- `gap:abandoned_checkout_recovery:orphan_metric_timing_effectiveness`: Metric hint "timing_effectiveness" does not clearly map to any generated column name; analytics should treat the formula as approximate.
- `gap:instant_forex:orphan_metric_aov_uplift_distribution`: Metric hint "aov_uplift_distribution" does not clearly map to any generated column name; analytics should treat the formula as approximate.
- `gap:instant_forex:orphan_metric_attach_rate_overall`: Metric hint "attach_rate_overall" does not clearly map to any generated column name; analytics should treat the formula as approximate.
- `gap:instant_forex:orphan_metric_best_attach_currencies`: Metric hint "best_attach_currencies" does not clearly map to any generated column name; analytics should treat the formula as approximate.
- `gap:instant_forex:orphan_metric_best_attach_destinations`: Metric hint "best_attach_destinations" does not clearly map to any generated column name; analytics should treat the formula as approximate.
- `gap:instant_forex:orphan_metric_segment_skew`: Metric hint "segment_skew" does not clearly map to any generated column name; analytics should treat the formula as approximate.
- `known_issue_link:abandoned_checkout_recovery:k1_ios_webkit_otp`: Feature abandoned_checkout_recovery touches payment/OTP/checkout flows. Analytics should cut by iOS/device and check against known issue K1 (iOS WebKit OTP autofill regression).
- `known_issue_link:abandoned_checkout_recovery:k5_whatsapp_nudge`: Feature abandoned_checkout_recovery relates to recovery/re-engagement. Context notes K5 WhatsApp nudge can lift returns for previously dropped users — separate campaign lift from product changes.
- `known_issue_link:express_checkout:k1_ios_webkit_otp`: Feature express_checkout touches payment/OTP/checkout flows. Analytics should cut by iOS/device and check against known issue K1 (iOS WebKit OTP autofill regression).
