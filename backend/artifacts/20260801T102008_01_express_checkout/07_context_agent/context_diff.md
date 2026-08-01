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

- One‑tap checkout for returning travellers, skips full payment form, collects only OTP, aims to reduce time‑to‑pay and lift checkout‑to‑success conversion

## Registry Status

- Known generated features: 1
- Known context contradictions: 2
