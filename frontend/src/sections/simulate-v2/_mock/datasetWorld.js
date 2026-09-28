/**
 * Does the environment's sandbox hold what a dataset row refers to?
 *
 * A row like "my order was meant to arrive Tuesday" with order_id ORD-40000
 * only tests something if the sandbox has a late order for the agent to find.
 * The sandbox is the environment's seed — tables with their notable slices
 * ("orders: 12% delayed, 6% lost in transit") — not the dataset's records.
 * So every record and account column on a row resolves one of three ways:
 *
 *   matched — the seed already has an equivalent (a seeded delayed order);
 *             the scenario runs against that.
 *   added   — the table exists but nothing seeded fits, so the scenario
 *             brings its own record, loaded into the sandbox when it runs.
 *   missing — the sandbox has no such table at all. The scenario couldn't
 *             run, so it can't be added until the world is rebuilt.
 *
 * Record columns resolve by name (order_id → orders); account columns resolve
 * to whichever table holds the people the agent serves.
 */

const PEOPLE_TABLES = ["customers", "users", "accounts", "members", "passengers", "patients", "cardholders"];

/* The notable slices a seed note can call out, and the words in a row that
   mean it needs one of them. */
const SLICES = [
  { note: /delay/, label: "delayed", hits: /(meant|supposed|due) to arrive|hasn't (arrived|shown up|come)|still hasn't|running late|\blate\b|delay/ },
  { note: /lost/, label: "lost-in-transit", hits: /lost|vanish|nothing at my door|never (came|arrived)|half my order/ },
  { note: /return window/, label: "out-of-window", hits: /return(ed)? .*month|month ago|return window/ },
  { note: /discontinu/, label: "discontinued", hits: /discontinu|out of stock|no longer (sold|made)/ },
  { note: /loyalty/, label: "loyalty-tier", hits: /loyalty/ },
];

const singular = (name) => name.replace(/ies$/, "y").replace(/s$/, "");
const stemOf = (key) => key.toLowerCase().replace(/_(id|ref|number|no|code)$/, "").replace(/_/g, " ").trim();

const tablesOf = (env) => env?.seed?.tables || [];

/** The seed table a column points at, or null when the sandbox has none. */
export function tableFor(env, column, role) {
  const tables = tablesOf(env);
  if (role === "account") return tables.find((t) => PEOPLE_TABLES.includes(t.name.toLowerCase())) || null;
  const stem = stemOf(column.key);
  return tables.find((t) => singular(t.name.toLowerCase()) === stem || t.name.toLowerCase().startsWith(stem)) || null;
}

/** The table a column would need, named for a message when the sandbox lacks it. */
const wantedTable = (column, role) => (role === "account" ? "customers" : `${stemOf(column.key)}s`);

/**
 * How the sandbox covers one row. `roles` is the column mapping; the
 * request and outcome text is what a record column is matched on (a row
 * about a late parcel needs a delayed order), an account's own value is what
 * an account column is matched on.
 */
export function sandboxFit(env, dataset, roles, row) {
  const text = dataset.columns
    .filter((c) => roles[c.key] === "prompt" || roles[c.key] === "expected")
    .map((c) => String(row[c.key] ?? ""))
    .join(" ")
    .toLowerCase();

  return dataset.columns
    .filter((c) => roles[c.key] === "record" || roles[c.key] === "account")
    .map((c) => {
      const role = roles[c.key];
      const value = String(row[c.key] ?? "");
      const table = tableFor(env, c, role);
      if (!table) {
        const want = wantedTable(c, role);
        return { column: c.key, role, value, status: "missing", table: want, text: `No ${want} table in the sandbox` };
      }
      const kind = singular(table.name);
      const hay = role === "account" ? value.toLowerCase() : text;
      const slice = SLICES.find((s) => s.note.test((table.note || "").toLowerCase()) && s.hits.test(hay));
      if (slice) {
        return { column: c.key, role, value, status: "matched", table: table.name, text: `Uses a seeded ${slice.label} ${kind}` };
      }
      return {
        column: c.key, role, value, status: "added", table: table.name,
        text: role === "account" ? `Sets up a “${value}” ${kind}` : `Adds ${value} to ${table.name}`,
      };
    });
}

/** The worst of a row's fits — one missing table means the row can't run. */
export const fitStatus = (fits) =>
  fits.some((f) => f.status === "missing") ? "missing"
    : fits.some((f) => f.status === "added") ? "added"
      : fits.length ? "matched" : "none";
