import { runPipeline } from "./pipeline/runPipeline.js";

const [, , command, specFolder] = process.argv;

function printHelp() {
  console.log(`
Schema Kings CLI

Usage:
  pnpm cli run <spec-folder>
  pnpm pipeline <spec-folder>

Examples:
  pnpm cli run ../specs/05_instant_forex
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
