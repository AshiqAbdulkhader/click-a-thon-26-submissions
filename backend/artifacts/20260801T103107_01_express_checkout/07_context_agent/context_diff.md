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

- OTP success varies by device/os/geo
- Express reduces time-to-pay via payment.latency_ms
- Adoption differs by saved_method_type and destination

## Registry Status

- Known generated features: 3
- Known context contradictions: 2
