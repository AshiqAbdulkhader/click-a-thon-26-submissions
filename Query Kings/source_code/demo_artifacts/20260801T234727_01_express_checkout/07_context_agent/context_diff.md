# Context Diff

## Added Feature

- Feature: Express Checkout
- Slug: `express_checkout`
- Table: `silver.express_checkout_events`
- Primary entity: `application_id`
- Workflow type: `funnel`
- Events: `express_checkout_shown` -> `express_checkout_selected` -> `saved_method_used` -> `otp_entered` -> `express_payment_confirmed`
- Success event: `express_payment_confirmed`

## Metric Hints

- Conversion lift vs standard checkout
- OTP success rate by device_type/os/geoip_country_code
- Payment latency (shown to confirmed)
- Adoption rate by device, geo, saved_method_type

## Context Notes

- device_type and os have nulls; handle missing values
- application_id may be empty for some events
- payment.latency_ms only present on success events

## Registry Status

- Known generated features: 1
- Known columns: 300
- Known workflows: 2
- Known metrics: 8
- Known joins: 97
- Known context contradictions / gaps / known-issue links: 4

## Open Contradictions & Gaps (sample)

- `base_context_eta_name_mismatch`: Base context mentions visa_issuance_eta_days, while the loaded application_started DDL exposes eta_shown.
- `conversion_denominator_ambiguity`: Base context defines leadership conversion as purchases divided by sessions, but funnel conversion as purchases divided by application_started users.
- `known_issue_link:express_checkout:k1_ios_webkit_otp`: Feature express_checkout touches payment/OTP/checkout flows. Analytics should cut by iOS/device and check against known issue K1 (iOS WebKit OTP autofill regression).
- `known_issue_link:express_checkout:k6_summer20`: Feature express_checkout may interact with promo/currency behaviour. K6 SUMMER20 campaign elevates coupon_applied and can lower realised value — do not treat value drops as pure product regressions without checking coupons.
