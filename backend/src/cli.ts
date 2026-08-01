import "dotenv/config";
import path from "node:path";
import { runAnalyticsAsk } from "./pipeline/analytics.js";
import { bootstrapContext } from "./pipeline/context.js";
import { runPipeline } from "./pipeline/runPipeline.js";
import { runSetup } from "./pipeline/setup.js";

const [, , command, ...args] = process.argv;
const specFolder = args[0];

function printHelp() {
  console.log(`
Schema Kings CLI

Usage:
  pnpm cli setup
  pnpm cli context:bootstrap
  pnpm cli run <spec-folder>
  pnpm cli ask <question>
  pnpm pipeline <spec-folder>

Examples:
  pnpm cli setup
  pnpm cli context:bootstrap
  pnpm cli run ../specs/05_instant_forex
  pnpm cli ask "Why is express checkout completion lower on iOS?"
  pnpm pipeline ../specs/01_express_checkout
`);
}

async function main() {
  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    printHelp();
    return;
  }

  if (command === "context:bootstrap") {
    const repoRoot = path.resolve(process.cwd(), "..");
    const registry = await bootstrapContext(repoRoot);
    console.log("Context bootstrap completed.");
    console.log(`Features in context: ${registry.features.length}`);
    console.log(`Open contradictions: ${registry.contradictions.length}`);
    return;
  }

  if (command === "setup") {
    const repoRoot = path.resolve(process.cwd(), "..");
    await runSetup({ repoRoot });
    return;
  }

  if (command === "ask") {
    const question = args.join(" ").trim();
    if (!question) {
      console.error("Missing required <question> argument.");
      printHelp();
      process.exitCode = 1;
      return;
    }
    const answer = await runAnalyticsAsk({ question });
    console.log("");
    console.log(answer.short_answer);
    if (answer.key_findings.length > 0) {
      console.log("");
      console.log("Key findings:");
      for (const finding of answer.key_findings) {
        console.log(`- ${finding}`);
      }
    }
    if (answer.evidence.length > 0) {
      console.log("");
      console.log("Evidence (claim → query → confidence):");
      for (const claim of answer.evidence) {
        console.log(
          `- [${claim.confidence}] ${claim.claim} (query: ${claim.query_id})`,
        );
      }
    }
    if (answer.recommended_actions.length > 0) {
      console.log("");
      console.log("Recommended actions:");
      for (const action of answer.recommended_actions) {
        console.log(`- ${action}`);
      }
    }
    if (answer.caveats.length > 0) {
      console.log("");
      console.log("Caveats:");
      for (const caveat of answer.caveats) {
        console.log(`- ${caveat}`);
      }
    }
    console.log("");
    console.log(`Artifacts: ${answer.artifact_root}`);
    console.log(`Langfuse trace ID: ${answer.trace_id}`);
    if (
      /temporarily unavailable|Strict analytics mode refused/i.test(
        `${answer.short_answer}\n${answer.caveats.join("\n")}`,
      )
    ) {
      process.exitCode = 2;
    }
    return;
  }

  if (command !== "run") {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  if (!specFolder) {
    console.error("Missing required <spec-folder> argument.");
    printHelp();
    process.exitCode = 1;
    return;
  }

  await runPipeline({ specFolder });
}

main().catch((error) => {
  console.error("CLI failed:");
  console.error(error);
  process.exitCode = 1;
});
