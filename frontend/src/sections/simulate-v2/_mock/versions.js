/**
 * Versions, and what pairs with what.
 *
 * The product goals ask for two things that pull in the same direction: an
 * environment must serve more than one agent version (G1), and environment
 * creation must not be welded to scenario creation (G7). Both fall out of one
 * rule — scenarios belong to the environment, and a run is a pairing:
 *
 *     run = environment version × agent version
 *
 * So the same proved scenarios can be pointed at v3 of an agent and then at
 * v2, and the difference is attributable to the agent rather than to a
 * scenario someone rewrote in between.
 */

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();

/* ── environment versions ────────────────────────────────────────────────── */

/**
 * Why an environment gets a new version: the world changed. Seed data, tool
 * handlers, rules. Scenarios carry the version they were proved against, so a
 * world change that invalidates a proof is visible rather than silent.
 */
export const environmentVersions = (env, envState) => {
  /* Minted versions win. An environment with none recorded has exactly one:
     its first build. (It used to be handed an invented three-version history,
     so an environment created a minute ago claimed a v1 "read from the agent
     source" three weeks old.) Environments with a real history — the seeded
     demo ones — carry it in their state like any other. */
  const stored = envState?.envVersions;
  const list = stored?.length ? [...stored].reverse() : [{
    id: `${env?.id}-v1`,
    label: "v1",
    createdAt: env?.adoptedAt || new Date().toISOString(),
    note: envState?.agent ? "First build, read from the agent." : "First build.",
    scenarios: envState?.scenarios?.length || 0,
    changed: ["contract", "seed"],
    builtFor: "v1",
  }];

  /*
    Stamp `.current` based on the active version pointer, so the version
    picker and the Settings list agree on which one is live. Without a
    pin, the newest is current — same behaviour as before switching
    existed.
  */
  const active = envState?.activeEnvVersion || list[0]?.label;
  return list.map((v) => ({ ...v, current: v.label === active }));
};

/**
 * A history for the seeded demo environments, oldest first — the same three
 * steps the fallback used to invent for every environment, now stated once
 * for the environments that actually have that history.
 */
export const seededEnvHistory = (env, scenarioCount) => {
  const back = (n) => Math.max(1, Math.round((scenarioCount || 0) * n));
  return [
    {
      id: `${env?.id}-v1`, label: "v1", createdAt: iso(24),
      note: "First build, read from the agent source.",
      scenarios: back(0.55), changed: ["contract", "seed"], builtFor: "v1",
    },
    {
      id: `${env?.id}-v2`, label: "v2", createdAt: iso(11),
      note: "Moved a rule out of the prompt and into the world, so breaking it now fails rather than reads badly.",
      scenarios: back(0.78), changed: ["rules"], builtFor: "v1",
    },
    {
      id: `${env?.id}-v3`, label: "v3", createdAt: iso(2),
      note: "Seeded the refusal paths so the scenarios that should be declined have something to be declined against.",
      scenarios: scenarioCount || 0, changed: ["seed", "checks"], builtFor: "v1",
    },
  ];
};

/**
 * What changing the world can consist of.
 *
 * Named rather than free-text because the *kind* of change decides which
 * proofs survive it: reseeding can strip the state a scenario presumes, and
 * rewriting checks can turn a check that used to fail on an empty run into one
 * that passes. A rules change does neither — it changes how a run is judged,
 * not whether it can be staged.
 */
export const ENV_CHANGES = [
  { id: "seed", label: "Reseeded the world", invalidates: true, blurb: "New or regenerated data — the state a scenario presumes may be gone." },
  { id: "checks", label: "Rewrote the checks", invalidates: true, blurb: "A check proved to fail on an empty run may now pass." },
  { id: "contract", label: "Tools changed", invalidates: true, blurb: "The reference solution may no longer run." },
  { id: "rules", label: "Rules changed", invalidates: false, blurb: "Graded differently; every scenario can still be staged." },
  { id: "scoring", label: "Graders changed", invalidates: false, blurb: "Evaluations or thresholds changed — runs before and after were graded differently." },
  { id: "actors", label: "Actors changed", invalidates: false, blurb: "Who else acts in the world changed — the episodes play out differently." },
];

/** The next environment version, given what already exists. */
export const nextEnvVersion = (env, envState, { changed = [], note, now, from } = {}) => {
  const list = environmentVersions(env, envState);
  const n = list.length + 1;
  /* A new version starts from the world it replaces — the pinned one unless
     told otherwise — so tools the world learned in a rebuild are not lost to
     a rules change made afterwards. */
  const base = (from && list.find((v) => v.label === from)) || list.find((v) => v.current) || list[0];
  return {
    ...(base?.tools && { tools: base.tools }),
    builtFor: base?.builtFor || "v1",
    id: `${env?.id}-v${n}`,
    label: `v${n}`,
    createdAt: now || new Date().toISOString(),
    note: note || "World changed.",
    scenarios: envState?.scenarios?.length || 0,
    changed,
    /* Minted after the scenarios existed. Marked, because a proof cannot be
       retroactively made against a version that did not exist when it was
       proved — see provedAgainst in proofs.js. */
    minted: true,
  };
};

/* ── agent versions ──────────────────────────────────────────────────────── */

/**
 * Versions of the thing under test. These are the customer's, not ours — we
 * drive whichever one they point us at and never host it (an explicit
 * non-goal), so a version here is a label plus how to reach it.
 *
 * A version is minted when the agent changes, and a run pins whichever one was
 * current when it started. It is emphatically *not* derived from the run count:
 * that made a second run of an unchanged agent claim to be a new version, and
 * made re-running the same version to check a flaky scenario impossible to
 * express. Change, then run — those are two events, and only the first one
 * makes a version.
 */
const firstAgentVersion = () => ({
  id: "agent-v1",
  label: "v1",
  note: "First version connected to this environment.",
  reach: "endpoint",
  createdAt: new Date().toISOString(),
});

/** The number in a version label — what phrasing and pinning key off. */
export const versionNumber = (label) => parseInt(String(label || "").replace(/\D/g, ""), 10) || 1;

/** Every agent version this environment knows about, oldest first. */
export const agentVersions = (envState) => {
  const stored = envState?.agentVersions;
  return stored?.length ? stored : [firstAgentVersion()];
};

/** The one the next run will use — the active pin if set, else the newest. */
export const currentAgentVersion = (envState) => {
  const list = agentVersions(envState);
  const activeLabel = envState?.activeAgentVersion;
  if (activeLabel) return list.find((v) => v.label === activeLabel) || list[list.length - 1];
  return list[list.length - 1];
};

/**
 * The next version.
 *
 * Product concept shift: a version isn't just a label attached to whatever
 * happens to be at the endpoint any more. When we mint one from an optimize
 * flow we know *which* changes went into it, and we know which version they
 * were applied on top of. Both travel on the version so a reader six weeks
 * from now can answer "what was actually different about v3" without digging
 * through the run that produced it.
 *
 *   applied         — the code changes bundled into this version, each with
 *                     its filepath and diff. Empty for versions minted by
 *                     "connect to a different endpoint".
 *   basedOnVersion  — the label of the version these changes were applied on
 *                     top of. Usually the previous one, but pinning it makes
 *                     branching possible if a user rolls back to v2 and edits
 *                     from there.
 *   fromRunId       — the run whose diagnosis produced these changes, so the
 *                     evidence lives beside the outcome.
 */
export const nextAgentVersion = (envState, {
  note, reach = "endpoint", now, applied = [], fromRunId = null, basedOnVersion = null, tools = null,
} = {}) => {
  const list = agentVersions(envState);
  /* Numbered past the highest label, not the count — a count can collide. */
  const n = Math.max(0, ...list.map((v) => versionNumber(v.label))) + 1;
  return {
    /* Only when this version's tools are known to differ; otherwise it
       inherits the tools of the version it was built on. */
    ...(tools && { tools }),
    id: `agent-v${n}`,
    label: `v${n}`,
    note: note || "Modified between runs.",
    reach,
    createdAt: now || new Date().toISOString(),
    applied,
    /* The version these changes were made on — the one being tested now,
       not simply the newest. */
    basedOnVersion: basedOnVersion || currentAgentVersion(envState)?.label || "v1",
    fromRunId,
  };
};

/** Newest first, with each version's run history attached — for list UIs. */
export const agentVersionsWithRuns = (envState) => {
  const runs = envState?.runs || [];
  return [...agentVersions(envState)].reverse().map((v, i) => ({
    ...v,
    current: i === 0,
    runs: runs.filter((r) => r.agentVersion === v.label).length,
  }));
};

/**
 * The env version the workspace is currently working off.
 *
 * Version switching is now a first-class action: `envState.activeEnvVersion`
 * pins whichever version the user chose to work from. If nothing is pinned
 * the newest is treated as active — same behaviour as before switching
 * existed, so environments that never invoked the picker keep reading the
 * way they used to.
 *
 * Runs stamp whichever version was active when they started; the version
 * list marks the active one with `.current` so the header pin and the
 * Settings list read the same story.
 */
export const currentEnvVersion = (env, envState) => {
  const list = environmentVersions(env, envState);
  const pinned = envState?.activeEnvVersion;
  const explicit = pinned ? list.find((v) => v.label === pinned) : null;
  return explicit || list.find((v) => v.current) || list[0];
};

