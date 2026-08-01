import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runAnalyticsAsk } from "../analytics.js";
import { generatePipelineReport } from "./generateReport.js";

export async function startReportServer(input?: {
  repoRoot?: string;
  port?: number;
}) {
  const repoRoot = input?.repoRoot ?? path.resolve(process.cwd(), "..");
  const port = input?.port ?? Number(process.env.REPORT_PORT ?? 8787);

  // Fresh overview on boot.
  await generatePipelineReport({ repoRoot });

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, repoRoot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[report server]", message);
      json(res, 500, { error: message });
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(port, () => resolve());
  });

  const url = `http://127.0.0.1:${port}`;
  console.log("");
  console.log(`Report UI: ${url}`);
  console.log("Ask from the page — answer lands in the same HTML.");
  console.log("Ctrl+C to stop.");
  console.log("");

  return { server, url, port };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  repoRoot: string,
) {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (
    method === "GET" &&
    (url.pathname === "/" || url.pathname === "/report.html")
  ) {
    const jobId = url.searchParams.get("job") ?? undefined;
    await generatePipelineReport({ repoRoot, jobId: jobId || undefined });
    const htmlPath = path.join(repoRoot, "frontend", "dist", "report.html");
    const html = await readFile(htmlPath, "utf8");
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(),
    });
    res.end(html);
    return;
  }

  if (method === "GET" && url.pathname === "/report-data.json") {
    const jsonPath = path.join(
      repoRoot,
      "frontend",
      "dist",
      "report-data.json",
    );
    const body = await readFile(jsonPath, "utf8");
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(),
    });
    res.end(body);
    return;
  }

  if (method === "POST" && url.pathname === "/api/ask") {
    const body = await readBody(req);
    let question = "";
    try {
      const parsed = JSON.parse(body) as { question?: string };
      question = parsed.question?.trim() ?? "";
    } catch {
      json(res, 400, { error: 'Expected JSON body: { "question": "..." }' });
      return;
    }
    if (!question) {
      json(res, 400, { error: "Missing question." });
      return;
    }

    console.log(`[ask] ${question}`);
    const answer = await runAnalyticsAsk({ question, repoRoot });
    const jobId = path.basename(answer.artifact_root);
    await generatePipelineReport({ repoRoot, jobId });

    json(res, 200, {
      job_id: jobId,
      question,
      short_answer: answer.short_answer,
      key_findings: answer.key_findings,
      evidence: answer.evidence,
      recommended_actions: answer.recommended_actions,
      caveats: answer.caveats,
      langfuse_trace_id: answer.trace_id,
      report_url: `/?job=${encodeURIComponent(jobId)}`,
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/health") {
    json(res, 200, { ok: true });
    return;
  }

  json(res, 404, { error: "Not found" });
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function json(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...corsHeaders(),
  });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
