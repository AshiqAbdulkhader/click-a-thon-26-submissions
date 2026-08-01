# Context Diff

## Added Feature

- Feature: Group / Family Applications
- Slug: `group_family`
- Table: `silver.group_family_events`
- Primary entity: `group_id`
- Workflow type: `funnel`
- Events: `group_started` -> `traveller_added` -> `traveller_removed` -> `group_submitted`
- Success event: `group_submitted`

## Metric Hints

- group_started_to_group_submitted_completion_rate_by_group_size
- traveller_add_remove_churn_rate
- docs_complete_bottleneck_by_group_size
- destination_segment_group_application_rate

## Context Notes

- Primary entity is group_id; events are grouped by group_id.
- Travellers are added/removed before submission; docs_complete per traveller.
- Group flow is separate from single application funnel.
- Use group_size to segment completion and churn metrics.

## Registry Status

- Known generated features: 4
- Known context contradictions: 2
