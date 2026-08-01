import { pipelineStages } from "./stages.js";

type RunPipelineInput = {
  specFolder: string;
};

export async function runPipeline(input: RunPipelineInput) {
  const jobId = createJobId(input.specFolder);

  console.log(`Starting pipeline`);
  console.log(`Job ID: ${jobId}`);
  console.log(`Spec folder: ${input.specFolder}`);
  console.log("");

  for (const stage of pipelineStages) {
    console.log(`[placeholder] ${stage.id}: ${stage.name}`);
    console.log(`  ${stage.description}`);
  }

  console.log("");
  console.log(
    "Pipeline scaffold finished. No real logic has been implemented yet.",
  );
}

function createJobId(specFolder: string) {
  const slug = specFolder.split("/").filter(Boolean).at(-1) ?? "unknown_spec";
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "");
  return `${timestamp}_${slug}`;
}
