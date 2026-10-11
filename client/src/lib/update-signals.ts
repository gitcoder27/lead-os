/**
 * docs/56 MDA-07: an update that says the work is finished, on a task that is
 * still open, is worth one question. The check is deliberately simple (and
 * forgiving of typos like "complted"); the UI asks, it never acts on its own.
 */
const FINISHED = /\b(done|finished|complete[d]?|compl[a-z]{0,3}ted|shipped|merged|deployed|released|resolved|fixed|closed|wrapped up)\b/i;
/** Words just before the match that turn it into a plan, a hedge or a negation. */
const HEDGE = /\b(not|never|no|almost|nearly|half|partly|partially|mostly|until|unless|once|when|if|after|before|will|to be|should|pending|waiting|get|getting|be)\b|n['’]t\b/i;

export function soundsFinished(text: string | null | undefined): boolean {
  if (!text) return false;
  for (const sentence of text.split(/(?<=[.!?;\n])\s*/)) {
    if (sentence.trim().endsWith('?')) continue;
    const match = FINISHED.exec(sentence);
    if (!match) continue;
    const before = sentence.slice(Math.max(0, match.index - 28), match.index);
    if (!HEDGE.test(before)) return true;
  }
  return false;
}
