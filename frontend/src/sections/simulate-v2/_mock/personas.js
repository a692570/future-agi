/**
 * Personas.
 *
 * A **persona** is who the agent serves — the caller, the customer, the
 * operator on the other end. The persona states the goal.
 *
 * Third parties that join the run with a goal of their own — a supervisor, a
 * fraud desk, someone speaking for the account holder — are not personas. They
 * are actors, and they live in actors.js. A failing downstream service is
 * neither: it is a fault in the world's tool handlers.
 *
 * A scenario has always carried a persona. These are the reusable briefs those
 * personas are drawn from — which is why they live in a library rather than
 * inside one environment: the same difficult caller is worth pointing at every
 * agent you own.
 *
 * They are versioned for the same reason scenarios are. If a result moves, it
 * has to be attributable to the agent rather than to a brief somebody rewrote.
 */

const iso = (d) => new Date(Date.now() - d * 86400000).toISOString();

export const PERSONA_KINDS = [
  { id: "persona", label: "Persona", blurb: "Who the agent is serving" },
];

/** Which modalities a persona makes sense in. */
export const MODALITIES = ["voice", "chat", "cua", "coding"];

export const PERSONA_LIBRARY = [
  {
    id: "per-frustrated-repeat",
    kind: "persona",
    name: "Frustrated repeat caller",
    blurb: "Has called twice already about the same order and expects to be recognised.",
    modalities: ["voice", "chat"],
    traits: ["impatient", "interrupts", "well-informed"],
    version: "v3",
    versions: [
      { label: "v3", createdAt: iso(3), note: "Barge-in made more aggressive after the agent learned to talk over it." },
      { label: "v2", createdAt: iso(19), note: "Added the second call to their history." },
      { label: "v1", createdAt: iso(40), note: "First draft." },
    ],
    usedBy: 9,
    owner: "you",
  },
  {
    id: "per-guest-no-account",
    kind: "persona",
    name: "Guest with no account",
    blurb: "Checked out as a guest, has the order number in an email, nothing else.",
    modalities: ["voice", "chat"],
    traits: ["cooperative", "vague on detail"],
    version: "v2",
    versions: [
      { label: "v2", createdAt: iso(8), note: "Gives the order number only when asked twice." },
      { label: "v1", createdAt: iso(31), note: "First draft." },
    ],
    usedBy: 6,
    owner: "you",
  },
  {
    id: "per-non-native",
    kind: "persona",
    name: "Non-native speaker, noisy line",
    blurb: "Second-language English on a poor connection — tests recovery, not comprehension alone.",
    modalities: ["voice"],
    traits: ["hesitant", "repeats themselves", "background noise"],
    version: "v1",
    versions: [{ label: "v1", createdAt: iso(12), note: "Built from three real transcripts." }],
    usedBy: 4,
    owner: "system",
  },
  {
    id: "per-power-user",
    kind: "persona",
    name: "Power user, terse",
    blurb: "Knows the product better than the script does and types in fragments.",
    modalities: ["chat", "cua"],
    traits: ["terse", "skips pleasantries", "corrects the agent"],
    version: "v2",
    versions: [
      { label: "v2", createdAt: iso(5), note: "Typos and dropped words added." },
      { label: "v1", createdAt: iso(22), note: "First draft." },
    ],
    usedBy: 7,
    owner: "you",
  },
];

/** Personas already injected into an environment, by modality fit. */
export const castFor = (env) => {
  const modality = env?.surface === "browser" ? "cua" : env?.surface === "cli" ? "coding" : env?.surface;
  return PERSONA_LIBRARY.filter((a) => a.modalities.includes(modality)).slice(0, 4).map((a) => a.id);
};

export const getPersona = (id) => PERSONA_LIBRARY.find((a) => a.id === id);
