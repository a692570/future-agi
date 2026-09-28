/**
 * Why a call ended — said the way a customer would say it.
 *
 * The voice pipeline reports hangups by their internal source
 * ("simulator-ended-call", "pipeline-error-…"). Shown raw, a perfectly normal
 * run reads "simulator ended the call", which sounds like something on our
 * side cut it off — when it is simply the simulated caller hanging up once
 * the conversation was over. So every surface shows the plain reason, and the
 * raw value stays on the record for whoever is debugging (the call's
 * Attributes, a tooltip).
 */

/* Raw pipeline value → what a person reads, per channel. */
const REASONS = {
  "simulator-ended-call": { call: "Caller ended the call", chat: "Caller ended the conversation", tone: "normal" },
  "assistant-ended-call": { call: "Agent ended the call", chat: "Agent ended the conversation", tone: "normal" },
  "assistant-forwarded-call": { call: "Transferred to a person", chat: "Handed over to a person", tone: "normal" },
  "customer-did-not-answer": { call: "No answer", chat: "Caller never replied", tone: "warn" },
  voicemail: { call: "Reached voicemail", chat: "Reached an auto-reply", tone: "warn" },
  "silence-timed-out": { call: "Ended after a long silence", chat: "Ended after no reply", tone: "warn" },
  "exceeded-max-duration": { call: "Reached the maximum call length", chat: "Reached the maximum conversation length", tone: "warn" },
  "pipeline-error-session-dropped": { call: "Call dropped — the connection was lost", chat: "Conversation dropped — the connection was lost", tone: "error" },
  "sandbox-not-ready": { call: "Didn't start — the environment wasn't ready", chat: "Didn't start — the environment wasn't ready", tone: "error" },
  "simulator-aborted": { call: "Stopped — the simulated caller went off script", chat: "Stopped — the simulated caller went off script", tone: "error" },
};

/** The plain reason for a raw value. Unknown values are made readable rather than shown as-is. */
export function endedReasonLabel(raw, channel = "call") {
  const known = REASONS[raw];
  if (known) return known[channel] || known.call;
  if (!raw) return null;
  const words = String(raw).replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * How this simulated call ended, read from what happened in it. The normal
 * case — the conversation ran its course and the caller hung up — is the one
 * the raw value made sound like a fault.
 */
export function endedReasonFor(task, { voice = true } = {}) {
  const channel = voice ? "call" : "chat";
  const f = task?.fault || {};
  let raw = "simulator-ended-call";
  if (f.transport) raw = "pipeline-error-session-dropped";
  /* A tool the world couldn't answer is a gap in the scoring, not in the
     call — the conversation itself ran to its end. */
  else if (f.environment && !f.toolGap) raw = "sandbox-not-ready";
  else if (f.simulator) raw = "simulator-aborted";
  return {
    raw,
    label: endedReasonLabel(raw, channel),
    tone: REASONS[raw]?.tone || "normal",
  };
}
