export const instrumentationStageConfig = {
  bronzeIngest: {
    id: "01_bronze_ingest",
    name: "Bronze Ingest",
    agent: "bronze_ingestor",
    description:
      "Persist raw spec.md and raw events.ndjson rows into the bronze ClickHouse layer.",
  },
  eventProfiler: {
    id: "02_event_profiler",
    name: "Event Profiler",
    agent: "event_profiler",
    description:
      "Summarize raw event names, fields, types, and sample values before schema generation.",
  },
  specParser: {
    id: "03_spec_parser",
    name: "Spec Parser",
    agent: "spec_parser_agent",
    description:
      "Use product context and the event profile to produce a feature manifest.",
  },
  schemaGenerator: {
    id: "04_schema_generator",
    name: "Schema Generator",
    agent: "schema_generator",
    description: "Generate the silver schema and raw-to-silver mapping plan.",
  },
  schemaCritic: {
    id: "05_schema_critic",
    name: "Schema Critic",
    agent: "schema_critic",
    description:
      "Review generated schema quality before executing it in ClickHouse.",
  },
  silverLoader: {
    id: "06_silver_loader",
    name: "Silver Loader",
    agent: "silver_loader",
    description: "Create the silver table and load normalized feature events.",
  },
  contextUpdater: {
    id: "07_context_agent",
    name: "Context Agent",
    agent: "context_agent_v0",
    description:
      "Persist validated table, entity, event, and metric context for later specs.",
  },
} as const;

export const completedInstrumentationStageIds = Object.values(
  instrumentationStageConfig,
).map((stage) => stage.id);
