import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type ContextBundle = {
  baseContext: string;
  existingDdl: string;
  instrumentationNotes: string;
  generatedContext: GeneratedContextRegistry;
};

export type GeneratedContextRegistry = {
  version: number;
  updated_at: string | null;
  features: Array<{
    feature_slug: string;
    table_name: string;
    primary_entity: string;
    event_names: string[];
    success_event: string | null;
    metric_hints: string[];
    added_at: string;
  }>;
  contradictions: Array<{
    id: string;
    summary: string;
    evidence: string;
  }>;
};

const emptyRegistry: GeneratedContextRegistry = {
  version: 1,
  updated_at: null,
  features: [],
  contradictions: [
    {
      id: "base_context_eta_name_mismatch",
      summary:
        "Base context mentions visa_issuance_eta_days, while the loaded application_started DDL exposes eta_shown.",
      evidence:
        "base_context.md defines visa_issuance_eta_days; data/ddl.sql defines application_started.eta_shown Nullable(String).",
    },
    {
      id: "conversion_denominator_ambiguity",
      summary:
        "Base context defines leadership conversion as purchases divided by sessions, but funnel conversion as purchases divided by application_started users.",
      evidence:
        "Metric definitions contain both formulas; analytics must choose based on question type.",
    },
  ],
};

export async function loadContextBundle(
  repoRoot: string,
): Promise<ContextBundle> {
  const [baseContext, existingDdl, instrumentationNotes, generatedContext] =
    await Promise.all([
      readFile(path.join(repoRoot, "base_context.md"), "utf8"),
      readFile(path.join(repoRoot, "data", "ddl.sql"), "utf8"),
      readFile(path.join(repoRoot, "data", "instrumentation_notes.md"), "utf8"),
      readGeneratedContext(repoRoot),
    ]);

  return {
    baseContext,
    existingDdl,
    instrumentationNotes,
    generatedContext,
  };
}

export async function updateGeneratedContext(input: {
  repoRoot: string;
  feature_slug: string;
  table_name: string;
  primary_entity: string;
  event_names: string[];
  success_event: string | null;
  metric_hints: string[];
}) {
  const registry = await readGeneratedContext(input.repoRoot);
  const features = registry.features.filter(
    (feature) => feature.feature_slug !== input.feature_slug,
  );

  features.push({
    feature_slug: input.feature_slug,
    table_name: input.table_name,
    primary_entity: input.primary_entity,
    event_names: input.event_names,
    success_event: input.success_event,
    metric_hints: input.metric_hints,
    added_at: new Date().toISOString(),
  });

  const updated: GeneratedContextRegistry = {
    ...registry,
    updated_at: new Date().toISOString(),
    features: features.sort((a, b) =>
      a.feature_slug.localeCompare(b.feature_slug),
    ),
  };

  const contextDir = path.join(input.repoRoot, "backend", "context");
  await mkdir(contextDir, { recursive: true });
  await writeFile(
    path.join(contextDir, "context_registry.json"),
    `${JSON.stringify(updated, null, 2)}\n`,
  );

  return updated;
}

async function readGeneratedContext(
  repoRoot: string,
): Promise<GeneratedContextRegistry> {
  try {
    const raw = await readFile(
      path.join(repoRoot, "backend", "context", "context_registry.json"),
      "utf8",
    );
    return JSON.parse(raw) as GeneratedContextRegistry;
  } catch {
    return emptyRegistry;
  }
}
