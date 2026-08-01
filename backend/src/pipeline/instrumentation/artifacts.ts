import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeStageJson(
  artifactRoot: string,
  stage: string,
  filename: string,
  value: unknown,
) {
  await writeStageText(
    artifactRoot,
    stage,
    filename,
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

export async function writeStageText(
  artifactRoot: string,
  stage: string,
  filename: string,
  value: string,
) {
  const dir = path.join(artifactRoot, stage);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), value);
}
