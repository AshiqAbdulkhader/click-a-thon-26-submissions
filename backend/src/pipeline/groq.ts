type GroqMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type GroqChatCompletion = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export async function callGroqJson<T>(input: {
  messages: GroqMessage[];
  model?: string;
  temperature?: number;
}): Promise<T | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return null;
  }

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model ?? process.env.GROQ_MODEL ?? "openai/gpt-oss-20b",
        messages: input.messages,
        temperature: input.temperature ?? 0.1,
        response_format: { type: "json_object" },
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Groq request failed: ${response.status} ${body}`);
  }

  const completion = (await response.json()) as GroqChatCompletion;
  const content = completion.choices?.[0]?.message?.content;
  if (!content) {
    return null;
  }

  return JSON.parse(content) as T;
}
