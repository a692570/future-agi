/**
 * One status per scenario — the answer to "can I trust this row?".
 *
 * A scenario used to carry its state as scattered marks: a red triangle, a
 * "Broken" chip, an amber shield, a "New" tag. Each meant something, none of
 * them lined up in a column, and none could be filtered on together. This
 * reduces them to one ordered answer, worst first, with the one line that
 * explains it.
 *
 *   broken        the world changed and the scenario no longer stages
 *   quarantined   it can't be proved (no outcome, no checks …)
 *   needs-env     a later rebuild added it; not part of the pinned version
 *   no-tool       it needs a tool this world can't answer
 *   stale         proved on an older world (or edited since) — re-prove
 *   proved        fine, on the pinned version
 *
 * "Release blocker" is not a status — it is how much a failure matters — so
 * it travels separately (`critical`).
 */
import { admissionOf } from "./coverage";
import { proofStatus } from "./proofs";
import { versionNumber } from "./versions";

export const STATUS_ORDER = ["broken", "quarantined", "needs-env", "no-tool", "stale", "proved"];

export const STATUS_META = {
  broken: { label: "Broken", tone: "#DC2626" },
  quarantined: { label: "Quarantined", tone: "#CA8A04" },
  "needs-env": { label: "Needs newer env", tone: null },
  "no-tool": { label: "Tool not in world", tone: "#CA8A04" },
  stale: { label: "Needs re-proof", tone: "#CA8A04" },
  proved: { label: "Proved", tone: null },
};

/**
 * `ctx` = { env, envState, envVersion, answers (Set of tool names the pinned
 * world answers), buildMode }.
 */
export const scenarioStatus = (row, ctx) => {
  const { env, envState, envVersion, answers, buildMode } = ctx;
  if (row?.provedBroke) {
    return { id: "broken", ...STATUS_META.broken, detail: "It no longer stages on this world since the environment changed. Re-prove or edit it." };
  }
  const admission = admissionOf(row);
  if (!admission.admitted) {
    return { id: "quarantined", ...STATUS_META.quarantined, detail: admission.reason };
  }
  if (row?.addedInEnv && envVersion && versionNumber(row.addedInEnv) > versionNumber(envVersion)) {
    return {
      id: "needs-env",
      ...STATUS_META["needs-env"],
      label: `Needs env ${row.addedInEnv}`,
      detail: `Added when environment ${row.addedInEnv} learned ${row.newTool || "a new tool"}. Runs on ${envVersion} leave it out.`,
    };
  }
  const missing = answers ? (row?.requiredTools || []).filter((t) => !answers.has(t)) : [];
  if (missing.length) {
    return {
      id: "no-tool",
      ...STATUS_META["no-tool"],
      detail: `Needs ${missing.join(", ")}, which environment ${envVersion} can't answer — it comes back not measured until the environment is rebuilt.`,
    };
  }
  if (!buildMode) {
    const proof = proofStatus(row, env, envState);
    if (proof.stale) {
      return {
        id: "stale",
        ...STATUS_META.stale,
        label: proof.edited ? "Edited · re-prove" : STATUS_META.stale.label,
        detail: proof.edited
          ? "Edited after it was proved — the proof is of the old version."
          : `Proved on environment ${proof.proved}; the world has changed since.`,
      };
    }
    return { id: "proved", ...STATUS_META.proved, label: `Proved · ${proof.proved}`, detail: `Staged, solvable and not vacuous on environment ${proof.proved}.` };
  }
  return { id: "proved", ...STATUS_META.proved, detail: "Staged, solvable and not vacuous." };
};

export const needsAttention = (status) => status.id !== "proved";
