/*
  Folding the Scenarios tab's flat, batch-tagged groups back into batches.
  Kept in a plain .js file so the batch components' file exports only
  components — React Fast Refresh can then swap it in place on every edit.
*/

/** Inner groups arrive flat, each tagged with its batch (newest batch first); fold them back. */
export const batchesFrom = (groups = []) => {
  const out = [];
  let current = null;
  groups.forEach((g) => {
    const meta = g.batchMeta;
    if (!meta) return;
    if (!current || current.meta.batchId !== meta.batchId) {
      current = { meta, innerGroups: [], rows: [] };
      out.push(current);
    }
    current.innerGroups.push(g);
    current.rows.push(...g.rows);
  });
  return out;
};
