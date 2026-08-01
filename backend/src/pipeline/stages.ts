export const pipelineStages = [
  {
    id: "01_bronze_ingest",
    name: "Bronze Ingest",
    description:
      "Store the raw spec.md and events.ndjson package exactly as received.",
  },
  {
    id: "02_event_profiler",
    name: "Event Profiler",
    description:
      "Inspect raw NDJSON events and summarize fields, event names, types, and IDs.",
  },
  {
    id: "03_spec_parser",
    name: "Spec Parser",
    description: "Turn the feature brief into a structured feature manifest.",
  },
  {
    id: "04_schema_generator",
    name: "Schema Generator",
    description: "Generate the Silver ClickHouse schema and event mapping.",
  },
  {
    id: "05_schema_critic",
    name: "Schema Critic",
    description:
      "Review schema quality, ClickHouse fit, field coverage, and query usefulness.",
  },
  {
    id: "06_silver_loader",
    name: "Silver Loader",
    description:
      "Create typed Silver table(s) and load normalized feature events.",
  },
  {
    id: "07_context_agent",
    name: "Context Agent",
    description: "Update feature, entity, table, and metric context.",
  },
  {
    id: "08_analytics_orchestrator",
    name: "Analytics Orchestrator",
    description:
      "Plan Gold analysis and route work to funnel, segment, revenue, and anomaly logic.",
  },
  {
    id: "09_gold_metrics",
    name: "Gold Metrics",
    description:
      "Run SQL and store business-ready metrics and result artifacts.",
  },
  {
    id: "10_insight_writer",
    name: "Insight Writer",
    description:
      "Write PM-facing insights, recommendations, and confidence notes.",
  },
  {
    id: "11_evidence_critic",
    name: "Evidence Critic",
    description:
      "Check that insights are supported by SQL results and context.",
  },
  {
    id: "12_trace_summary",
    name: "Trace Summary",
    description: "Finalize run summary and attach Langfuse trace information.",
  },
] as const;
