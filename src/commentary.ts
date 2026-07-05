// PitchPulse - DeepInfra one-liner commentary per event. The FACTUAL description is always templated
// from verified TxLINE data (the model swaps in famous player/team names if it writes facts). The AI
// only adds nameless colour, pinned to the two real teams.
import { chat } from './llm';

export interface EventInput {
  type: string; home: string; away: string; score: string; phase: string;
  team?: string; player?: string; playerOut?: string; goalType?: string;
  scoreline?: string; minute?: number | null; round?: string | null; venue?: string | null; history?: string[]; detail?: string;
  recent?: string[]; // the widget's own last few lines - so the model can vary its language
}

const OPINION_SYSTEM = `You are a witty football commentator. The factual description of this event is ALREADY written by the system. Add ONE short sentence of colour or opinion - what it means for the match, or (if "odds" is present) the market read in plain English. HARD RULES: do NOT name any player. Do NOT restate the score, the scorer, or the minute. Do NOT invent any fact - no venue, assist, technique, or events not in "history". Do NOT call either team the hosts or the home side. "recent" contains your own previous lines: do NOT reuse their distinctive phrases or cliches (vary your vocabulary every line). Refer to the teams ONLY by the two names given below; never mention any other team or country. Max 20 words. Output only the sentence.`;

export async function commentate(apiKey: string | undefined, ev: EventInput): Promise<string> {
  return finalize(ev, await body(apiKey, ev));
}

// Prepend the minute (start of every update) and convert any em dashes to hyphens.
function finalize(ev: EventInput, text: string): string {
  const s = String(text).replace(/—/g, '-').replace(/\s{2,}/g, ' ').trim();
  return ev.minute != null ? `${fmtMinute(ev.minute, ev.phase)}' - ${s}` : s;
}

// Stoppage-time display: a 51st-minute clock reading in the first half is 45+6', not 51'
// (which reads as if it happened after half-time); likewise 98' in the second half is 90+8'.
function fmtMinute(m: number, phase: string): string {
  if ((phase === 'H1' || phase === 'HT') && m > 45) return `45+${m - 45}`;
  if (m > 120) return `120+${m - 120}`;
  if ((phase === 'H2' || phase === 'F') && m > 90) return `90+${m - 90}`;
  return String(m);
}

async function body(apiKey: string | undefined, ev: EventInput): Promise<string> {
  const fact = factSentence(ev);
  if (!apiKey) return fact;
  try {
    // The model never sees player names (can't echo a wrong one) and is pinned to the two real teams.
    const noNames = { ...ev, player: undefined, playerOut: undefined };
    const sys = `${OPINION_SYSTEM}\nThe only two teams in this match are "${ev.home}" and "${ev.away}".`;
    const c = await chat(apiKey, { system: sys, user: JSON.stringify(noNames), maxTokens: 90 });
    return c ? `${fact} ${c.trim()}` : fact;
  } catch { return fact; }
}

function goalTypeWord(t?: string): string {
  const m: Record<string, string> = { Header: 'heads home', Penalty: 'converts the penalty', FreeKick: 'scores from the free-kick' };
  return (t && m[t]) || 'scores';
}
// Deterministic factual sentence from verified data - no AI. The minute is prepended by finalize().
function factSentence(ev: EventInput): string {
  const line = ev.scoreline || `${ev.home} ${ev.score} ${ev.away}`;
  const team = ev.team ? ` (${ev.team})` : '';
  const at = ev.venue ? ` at ${ev.venue}` : '';
  switch (ev.type) {
    case 'goal':
      if (ev.goalType === 'OwnGoal') return `Own goal - ${line}.`;
      // Player name can be missing (not yet in the lineup map) - never print "undefined".
      if (!ev.player) return `GOAL${ev.team ? ' for ' + ev.team : ''} - ${line}.`;
      return `${ev.player}${team} ${goalTypeWord(ev.goalType)} - ${line}.`;
    case 'red_card':
      if (!ev.player) return `Red card${ev.team ? ' for ' + ev.team : ''} - ${ev.team || 'they'} down to ten at ${line}.`;
      return `Red card for ${ev.player}${team} - ${ev.team || 'they'} down to ten at ${line}.`;
    case 'yellow_card': return ev.player ? `Yellow card for ${ev.player}${team}.` : `Yellow card${ev.team ? ' for ' + ev.team : ''}.`;
    case 'substitution': return `${ev.team || 'Team'} change: ${ev.player || '?'} on, ${ev.playerOut || '?'} off.`;
    case 'kickoff': return `Kick-off${at} - ${ev.home} vs ${ev.away}${ev.round ? ', ' + ev.round : ''}.`;
    case 'half_time': return `Half-time - ${line}.`;
    case 'full_time': return `Full-time - ${line}.`;
    case 'odds_shift': return `Market move - ${line}${ev.detail ? ' (' + ev.detail + ')' : ''}.`;
    default: return line;
  }
}
