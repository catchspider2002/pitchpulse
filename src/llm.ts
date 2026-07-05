// DeepInfra - OpenAI-compatible chat completions (https://api.deepinfra.com/v1/openai).
export const DEEPINFRA_MODEL = 'zai-org/GLM-5.2';

const URL = 'https://api.deepinfra.com/v1/openai/chat/completions';

export async function chat(
  apiKey: string,
  opts: { system: string; user: string; maxTokens: number; model?: string },
): Promise<string | null> {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: opts.model || DEEPINFRA_MODEL,
      max_tokens: opts.maxTokens,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json() as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
  const ch = data.choices?.[0];
  let text = ch?.message?.content?.trim() || null;
  // finish_reason "length" = the reply was hard-clipped at max_tokens, usually mid-sentence.
  // Keep only complete sentences; if none survived, return null so the caller falls back to
  // the templated factual line.
  if (text && ch?.finish_reason === 'length') {
    const cut = Math.max(text.lastIndexOf('.'), text.lastIndexOf('!'), text.lastIndexOf('?'));
    text = cut > 0 ? text.slice(0, cut + 1).trim() : null;
  }
  return text;
}
