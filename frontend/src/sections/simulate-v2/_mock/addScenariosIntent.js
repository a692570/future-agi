/**
 * Does a chat message ask for more scenarios — and how many?
 *
 * "Add 20 more scenarios" was the only phrasing that worked: the check wanted
 * the word "scenario", so the natural follow-ups — "add 30 more", "give me 10
 * more", "write 4 more edge cases" — fell through to a generic reply and
 * nothing was added. The builder and the workspace chat both read requests
 * with this one function, so they agree on what counts.
 *
 * Returns { count } or null.
 */
const VERB = /(^|\s)(add|generate|create|make|give me|write|produce|draft)\b/;
/* What makes it a request for scenarios, rather than for something else. */
const TARGET = /scenar|\bmore\b|\b(edge|test)[\s-]*cases?\b|\b(add|generate|create|make|write|produce|draft)\s+\d{1,3}\b/;
/* Requests about other things that also say "add … more". */
const OTHER = /\b(evals?|evaluations?|tools?|rules?|personas?|actors?|agents?|versions?|checks?)\b/;

/* The prompt the "Add scenarios" skill chip prepends — anything sent with it
   is a request to add scenarios, however the rest is phrased. */
const CHIP = /^add scenarios\b/;

export const detectAddScenariosIntent = (text) => {
  const t = (text || "").toLowerCase().trim();
  if (!VERB.test(t) || !TARGET.test(t)) return null;
  /* "add a scenario where the caller …" is one specific edit, not a batch —
     unless it came through the skill chip, which always means a batch. */
  if (/where\s+the/.test(t) && !CHIP.test(t)) return null;
  if (!/scenar/.test(t) && OTHER.test(t)) return null;
  const num = t.match(/\b(\d{1,3})\b/);
  const fewish = /a few|some|another|couple/.test(t) ? 5 : null;
  const count = num ? Math.min(50, parseInt(num[1], 10)) : (fewish || 8);
  return count > 0 ? { count, asked: !!num } : null;
};

/**
 * What the request describes, once the asking is stripped off —
 * "Add scenarios. callers disputing a double charge" → "callers disputing
 * a double charge". Null when there's nothing but the ask ("add 10 more"),
 * which means "more of what the environment would derive", not something new.
 */
export const describedAsk = (text) => {
  const d = (text || "").trim()
    .replace(/^add scenarios[.:,!\s-]*/i, "")
    .replace(/^(please\s+)?(add|generate|create|make|give me|write|produce|draft)\s+/i, "")
    .replace(/^(a few|some|another|a couple( of)?|\d{1,3})\s+/i, "")
    .replace(/^(more\s+)?(new\s+)?(scenarios?|edge[\s-]*cases?|test[\s-]*cases?)\b[.:,\s-]*/i, "")
    .replace(/^(for|about|where|with|covering|on|of|that)\s+/i, "")
    .replace(/[.\s]+$/, "");
  return d.length >= 6 && /[a-z]{3}/i.test(d) ? d : null;
};
