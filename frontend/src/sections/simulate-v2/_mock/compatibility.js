/**
 * Does this agent fit this world?
 *
 * Building an environment *from* an agent makes the contract match by
 * construction. Adopting a template does not: the world answers the
 * template's tools, and the agent brings its own. The two can differ in two
 * directions, and they are not equally bad — this is the same one-way rule as
 * toolFit.js:
 *
 *   unanswered  A tool the agent calls that the world cannot answer. Every
 *               call to it goes unanswered, so the run scores the agent for
 *               the environment's gap. Those scenarios cannot be measured
 *               until the world learns the tool — this blocks a clean run.
 *
 *   notCalled   A tool the world answers that the agent does not have. That
 *               is fine to run: the scenarios that need it measure a real
 *               capability gap in the agent, which is exactly what they are
 *               for.
 *
 * So we probe the agent's declared tools and say plainly which way each
 * mismatch goes, before the first run rather than after it.
 */
import { getRows } from "./scenarios";
import { worldToolsFor } from "./toolFit";

/** Deterministic per environment, so a demo replays the same way. */
const hash = (s = "") => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 9973, 7);

/* Tools a connected agent plausibly declares that a template world has never
   seen. The prototype has no live probe, so one of these may turn up. */
const FOREIGN_TOOLS = ["get_account_balance", "send_csat_survey"];

/**
 * The probe's reading of the agent. With `agentTools` it compares what the
 * agent actually declares; without, it simulates a probe deterministically:
 * the agent lacks one or two of the world's tools and, for some environments,
 * brings one the world cannot answer.
 */
const probedAgentTools = (env, world, agentTools) => {
  if (agentTools) return agentTools.map((t) => (typeof t === "string" ? t : t.name));
  const h = hash(env.id);
  const lackCount = Math.min(2, Math.max(1, world.length % 3));
  const start = h % Math.max(1, world.length - lackCount);
  const lacks = world.slice(start, start + lackCount);
  const foreign = FOREIGN_TOOLS.slice(0, h % 2);
  return [...world.filter((t) => !lacks.includes(t)), ...foreign];
};

export const checkCompatibility = (env, envState, { agentTools } = {}) => {
  if (!env) return null;
  const world = worldToolsFor(env, envState).map((t) => t.name);
  if (!world.length) return null;

  const agent = probedAgentTools(env, world, agentTools);
  const answers = new Set(world);
  const calls = new Set(agent);

  const matched = agent.filter((t) => answers.has(t));
  const unanswered = agent.filter((t) => !answers.has(t));
  const notCalled = world.filter((t) => !calls.has(t));

  /*
    The core pack is one scenario per tool, so a tool the agent lacks maps
    exactly onto the scenarios that will measure that gap. They still run.
  */
  const core = getRows(`${env.id}::core`, env);
  const gapScenarios = core.filter((r) => notCalled.some((m) => r.title.includes(m)));

  const list = (names) => names.join(", ");
  const probe = [
    { label: "connect()", result: "handshake ok" },
    { label: "list_tools()", result: `${agent.length} declared` },
    { label: "compare()", result: `world answers ${matched.length} of ${agent.length} the agent calls` },
    unanswered.length
      ? { label: "unanswered", result: `${list(unanswered)} — the world can't answer ${unanswered.length === 1 ? "it" : "these"}; rebuild the world before a clean run` }
      : { label: "unanswered", result: "none — every tool the agent calls is answered" },
    notCalled.length && {
      label: "not called",
      result: `${list(notCalled)} — the agent lacks ${notCalled.length === 1 ? "it" : "these"}; ${gapScenarios.length} scenario${gapScenarios.length === 1 ? "" : "s"} will measure the gap`,
    },
  ].filter(Boolean);

  return {
    world,
    agent,
    matched,
    unanswered,
    notCalled,
    gapScenarios,
    /* Only the agent → world direction blocks. */
    ready: unanswered.length === 0,
    needsRebuild: unanswered.length > 0,
    probe,
  };
};
