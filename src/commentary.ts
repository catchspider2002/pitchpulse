// PitchPulse — Claude one-liner commentary per event. Deterministic fallback if no key.
const SYSTEM = `You are a sharp, witty football commentator covering the 2026 World Cup.
When given a match event in JSON, write exactly ONE sentence of live commentary.

Rules:
- Maximum 25 words.
- Present tense, active voice.
- Sound like a knowledgeable fan, not a corporate press release.
- For goals: describe the moment with a visual detail.
- For red cards: note the drama and consequence.
- For odds shifts: explain what the market is saying in plain English.
- For half time / full time: summarise the mood in one line.
- Never start with "And" or "Well".
- Output only the commentary sentence, nothing else.`;

export interface EventInput {
  type: string; home: string; away: string; score: string; phase: string; detail?: string;
}

export async function commentate(apiKey: string | undefined, ev: EventInput): Promise<string> {
  const fb = fallback(ev);
  if (!apiKey) return fb;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 100, system: SYSTEM, messages: [{ role: 'user', content: JSON.stringify(ev) }] }),
    });
    if (!res.ok) return fb;
    const data = await res.json() as { content?: { text?: string }[] };
    return data.content?.[0]?.text?.trim() || fb;
  } catch { return fb; }
}

function fallback(ev: EventInput): string {
  switch (ev.type) {
    case 'goal': return `GOAL! ${ev.home} ${ev.score} ${ev.away} — the net ripples and the crowd erupts.`;
    case 'red_card': return `Red card! Down to ten men — this changes everything with the score at ${ev.score}.`;
    case 'yellow_card': return `Into the book he goes — the referee has seen enough.`;
    case 'kickoff': return `We are underway — ${ev.home} vs ${ev.away} is live.`;
    case 'half_time': return `Half time: ${ev.home} ${ev.score} ${ev.away}. A breather before the second act.`;
    case 'full_time': return `Full time: ${ev.home} ${ev.score} ${ev.away}. That's all she wrote.`;
    case 'odds_shift': return `The market lurches${ev.detail ? ' — ' + ev.detail : ''}; money is moving on this one.`;
    default: return `${ev.home} ${ev.score} ${ev.away} — ${ev.type}.`;
  }
}
