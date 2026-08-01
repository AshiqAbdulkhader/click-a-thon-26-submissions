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

- express_checkout_shown_to_express_payment_confirmed_conversion
- step_through_rate
- segment_comparison

## Context Notes

- Track OTP success by device_type/os/geoip_country_code
- Measure payment.latency_ms from shown to confirmed
- Adoption by saved_method_type (card/upi/wallet)

## Registry Status

- Known generated features: 3
- Known context contradictions: 2
