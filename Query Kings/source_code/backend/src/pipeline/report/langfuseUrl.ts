/** Shared Langfuse deep-link helper for report HTML. */

export function langfuseTraceUrl(traceId: string): string {
  if (!traceId) return "";

  const template = process.env.LANGFUSE_TRACE_URL_TEMPLATE?.trim();
  if (template) {
    return template
      .replaceAll("{trace_id}", traceId)
      .replaceAll("{id}", traceId);
  }

  const base =
    process.env.LANGFUSE_BASE_URL?.replace(/\/$/, "") ||
    process.env.LANGFUSE_HOST?.replace(/\/$/, "") ||
    "http://localhost:3000";

  const projectId = process.env.LANGFUSE_PROJECT_ID?.trim();
  if (projectId) {
    const params = new URLSearchParams();
    params.set("search", traceId);
    // Langfuse UI expects both searchType entries (id + content).
    return `${base}/project/${projectId}/traces?${params.toString()}&searchType=id&searchType=content`;
  }

  // Fallback when project id is missing — still searchable in Langfuse UI.
  return `${base}/traces?search=${encodeURIComponent(traceId)}&searchType=id&searchType=content`;
}
