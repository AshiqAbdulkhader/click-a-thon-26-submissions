import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";

if (!process.env.LANGFUSE_BASE_URL && process.env.LANGFUSE_HOST) {
  process.env.LANGFUSE_BASE_URL = process.env.LANGFUSE_HOST;
}

export const langfuseSdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
});

export function assertLangfuseEnv() {
  const missing = [
    "LANGFUSE_PUBLIC_KEY",
    "LANGFUSE_SECRET_KEY",
    "LANGFUSE_BASE_URL",
  ].filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing Langfuse env vars: ${missing.join(", ")}. Copy backend/.env.example to backend/.env and add your project API keys.`,
    );
  }
}

export function startLangfuse() {
  assertLangfuseEnv();
  langfuseSdk.start();
}

export async function shutdownLangfuse() {
  await langfuseSdk.shutdown();
}
