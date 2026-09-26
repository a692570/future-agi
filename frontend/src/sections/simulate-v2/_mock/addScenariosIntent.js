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

export const detectAddScenariosIntent = (text) => {
  const t = (text || "").toLowerCase();
  if (!VERB.test(t) || !TARGET.test(t)) return null;
  /* "add a scenario where the caller …" is one specific edit, not a batch. */
  if (/where\s+the/.test(t)) return null;
  if (!/scenar/.test(t) && OTHER.test(t)) return null;
  const num = t.match(/\b(\d{1,3})\b/);
  const fewish = /a few|some|another|couple/.test(t) ? 5 : null;
  const count = num ? Math.min(50, parseInt(num[1], 10)) : (fewish || 8);
  return count > 0 ? { count } : null;
};
