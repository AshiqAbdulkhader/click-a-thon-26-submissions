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
- channel_effectiveness_on_reconversion
- timing_effect_on_reconversion
- segment_based_reconversion_rate

## Context Notes

- Recovery workflow for abandoned checkout, primary entity application_id, success event reconverted, metrics focus on drop_step, channel, timing, segments.

## Registry Status

- Known generated features: 5
- Known context contradictions: 2
