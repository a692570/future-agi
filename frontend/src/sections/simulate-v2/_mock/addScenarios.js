/**
 * Stamping a new batch of scenarios — the same way whichever route adds it.
 *
 * The Add scenarios drawer, the builder chat on the build screen and the
 * workspace chat all add batches. Each batch records who added it and how,
 * the tools each scenario needs, the environment version it was proved
 * against — and the environment version it was added under, so a scenario
 * added on env v2 is not part of env v1 when v1 is pinned again. The
 * scenarios that need a tool this world can't answer are counted, so every
 * route can warn about them.
 */
import { stampProvenance, defaultBatchId } from "./scenarioProvenance";
import { currentEnvVersion } from "./versions";
import { knownToolsFor, requiredToolsOf, worldToolsFor } from "./toolFit";

export const stampNewBatch = (rows, { env, envState, source, actor, at = new Date().toISOString() }) => {
  const envLabel = currentEnvVersion(env, envState).label;
  const known = knownToolsFor(env, envState);
  const answers = new Set(worldToolsFor(env, envState).map((t) => t.name));
  const batchId = defaultBatchId(source, at);
  const stamped = (rows || []).map((r) => ({
    ...stampProvenance(r, { source, actor, at, batchId }),
    requiredTools: requiredToolsOf(r, known),
    provedAgainst: r.provedAgainst || envLabel,
    provedAt: r.provedAt || at,
    addedInEnv: envLabel,
  }));
  const unanswerable = [...new Set(stamped.flatMap((r) => r.requiredTools.filter((t) => !answers.has(t))))];
  const needing = stamped.filter((r) => r.requiredTools.some((t) => !answers.has(t))).length;
  return { rows: stamped, envLabel, unanswerable, needing };
};

/** The warning every add route shows when some of a batch can't be measured yet. */
export const unanswerableNote = ({ needing, unanswerable, envLabel }) => (needing
  ? `${needing} of these need ${unanswerable.join(", ")}, which environment ${envLabel} can't answer — they come back not measured until the environment is rebuilt.`
  : null);
