import { startActiveObservation } from "@langfuse/tracing";
import { shutdownLangfuse, startLangfuse } from "./langfuse.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runMockLangfuseTrace() {
  startLangfuse();

  const jobId = `mock_${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")}_instant_forex`;

  try {
    await startActiveObservation(
      "schema-kings.mock-pipeline",
      async (rootSpan) => {
        rootSpan.update({
          input: {
            job_id: jobId,
            feature_slug: "instant_forex",
            source: "../specs/05_instant_forex",
          },
          metadata: {
            environment: "local",
            pipeline: "bronze-silver-gold",
            mock: true,
          },
        });

        await startActiveObservation("01_bronze_ingest", async (span) => {
          await wait(120);
          span.update({
            input: {
              spec_file: "spec.md",
              events_file: "events.ndjson",
            },
            output: {
              bronze_tables: ["bronze.feature_specs", "bronze.feature_events"],
              raw_events_seen: 1280,
            },
          });
        });

        await startActiveObservation("02_event_profiler", async (span) => {
          await wait(90);
          span.update({
            input: {
              feature_slug: "instant_forex",
            },
            output: {
              events: [
                "forex_offer_shown",
                "currency_selected",
                "amount_entered",
                "forex_added_to_cart",
                "forex_purchased",
              ],
              candidate_entity_key: "application_id",
              nested_fields: [],
            },
          });
        });

        await startActiveObservation("04_schema_generator", async (span) => {
          await wait(160);
          span.update({
            input: {
              target_layer: "silver",
              feature_slug: "instant_forex",
            },
            output: {
              table: "silver.silver_instant_forex_events",
              order_by: [
                "timestamp",
                "application_id",
                "user_id",
                "event_name",
              ],
              status: "schema_draft_created",
            },
            metadata: {
              agent: "instrumentation_agent",
            },
          });
        });

        await startActiveObservation("07_context_agent", async (span) => {
          await wait(80);
          span.update({
            input: {
              base_context: "base_context.md",
              new_table: "silver.silver_instant_forex_events",
            },
            output: {
              metric_added: "attach_rate",
              formula: "forex_purchased / forex_offer_shown",
              related_area: "checkout",
            },
            metadata: {
              agent: "context_agent",
            },
          });
        });

        await startActiveObservation(
          "08_analytics_orchestrator",
          async (span) => {
            await wait(140);
            span.update({
              input: {
                pm_questions: [
                  "Attach rate by destination",
                  "Where does the funnel drop?",
                  "What is AOV uplift?",
                ],
              },
              output: {
                planned_agents: [
                  "funnel_agent",
                  "segment_agent",
                  "revenue_agent",
                ],
                queries_planned: 3,
              },
              metadata: {
                agent: "analytics_orchestrator",
              },
            });
          },
        );

        await startActiveObservation("10_insight_writer", async (span) => {
          await wait(110);
          span.update({
            input: {
              metric: "attach_rate",
              top_segment: "destination=AE",
            },
            output: {
              title: "Instant Forex attach is strongest for UAE trips",
              summary:
                "Mock insight: UAE trips show the strongest attach rate, while most drop-off appears after amount entry.",
              confidence: 0.82,
            },
            metadata: {
              agent: "insight_writer_agent",
            },
          });
        });

        rootSpan.update({
          output: {
            job_id: jobId,
            status: "mock_trace_completed",
            expected_view: "Langfuse Traces",
          },
        });
      },
    );

    console.log("Mock Langfuse trace sent.");
    console.log(`Job ID: ${jobId}`);
    console.log(
      "Open Langfuse at http://localhost:3000 and check the Traces view.",
    );
  } finally {
    await shutdownLangfuse();
  }
}
