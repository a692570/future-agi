import PropTypes from "prop-types";
import { useMemo, useState } from "react";
import { alpha } from "@mui/material/styles";
import {
  Box, Stack, Typography, Button, Checkbox, Collapse, IconButton, Tooltip,
  TextField, Select, MenuItem,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import Iconify from "src/components/iconify";
import ErrorSeverityBadge from "src/pages/dashboard/error-feed/components/ErrorSeverityBadge";
import { SectionCard } from "../../components/primitives";
import { productionClustersFor, scenariosFromCases, productionScenarioId } from "../../_mock/productionClusters";

/**
 * Add scenarios from production.
 *
 * The Error Feed already clusters failing traces by fingerprint. This
 * route promotes them into scenarios, so every real-world regression the
 * agent ever hit is a permanent test the simulation runs against —
 * closing the loop between production and the environment that shipped it.
 *
 * A cluster becomes one scenario per distinct case, not one per trace:
 * the 84 traces behind `lookup_order::TypeError` are three situations
 * (a dashed value, a typo, an email instead of an ID), and three
 * scenarios test them — 84 would test the same three things 84 times.
 * Picking a cluster picks all its cases; the expanded row lets you drop
 * the ones you don't want.
 *
 * Each imported scenario keeps a link back to its cluster, its case and
 * the traces it came from, so a later view can say "this scenario
 * reproduces case Y of cluster X, seen N times".
 */
export default function ProductionImport({ env, onAdd, selected }) {
  const clusters = useMemo(() => productionClustersFor(env), [env]);
  const alreadyIn = useMemo(
    () => new Set(selected.map((s) => s.id)),
    [selected],
  );
  /* A case is already in if its own scenario is — or, for imports made
     before clusters split into cases, if the whole cluster is. */
  const isAdded = (c, k) => alreadyIn.has(productionScenarioId(c, k)) || alreadyIn.has(`from-prod::${c.id}`);
  const openCases = (c) => c.cases.filter((k) => !isAdded(c, k));

  const [severity, setSeverity] = useState("all");
  const [query, setQuery] = useState("");
  /* { [clusterId]: { [caseId]: true } } */
  const [picked, setPicked] = useState({});

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clusters.filter((c) => {
      if (severity !== "all" && c.severity !== severity) return false;
      if (!q) return true;
      const hay = `${c.title} ${c.fingerprint} ${c.kindLabel}`.toLowerCase();
      return hay.includes(q);
    });
  }, [clusters, severity, query]);

  const pickedCases = (c) => openCases(c).filter((k) => picked[c.id]?.[k.id]);
  const chosen = shown
    .map((c) => ({ cluster: c, cases: pickedCases(c) }))
    .filter((p) => p.cases.length > 0);
  const scenarioCount = chosen.reduce((n, p) => n + p.cases.length, 0);
  const importable = shown.filter((c) => openCases(c).length > 0);

  const allOf = (c) => Object.fromEntries(openCases(c).map((k) => [k.id, true]));
  /* The cluster checkbox picks every case it still has open, or — when
     they're all picked already — clears them. */
  const toggleCluster = (c) => setPicked((p) => ({
    ...p,
    [c.id]: pickedCases(c).length === openCases(c).length ? {} : allOf(c),
  }));
  const toggleCase = (c, k) => setPicked((p) => ({
    ...p,
    [c.id]: { ...p[c.id], [k.id]: !p[c.id]?.[k.id] },
  }));
  const selectAll = () => {
    const next = { ...picked };
    importable.forEach((c) => { next[c.id] = allOf(c); });
    setPicked(next);
  };
  const clear = () => setPicked({});

  const commit = () => onAdd(scenariosFromCases(chosen));

  return (
    /*
      No section title/subtitle — the drawer header ("From production ·
      Promote failure clusters…") already introduces this pane, and a
      second heading strip on top of it read as duplicated content. The
      toolbar row is the top of the card now, with the primary action
      inline on the right so the button doesn't wrap onto two lines.
    */
    <SectionCard sx={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/*
        Two calm rows instead of one packed strip. Row 1 is the primary
        toolbar (search + severity + Add). Row 2 is a slim meta bar with
        the cluster count on the left and the bulk actions (Select all /
        Clear) as quiet text links on the right. Splitting lets each row
        breathe and puts the primary action alone with nothing crowding
        it — before this, six controls fought on one line.
      */}
      <Stack
        direction="row" alignItems="center" spacing={1.5}
        sx={{ px: 2.5, py: 1.25, borderBottom: "1px solid", borderColor: "divider", flexShrink: 0 }}
      >
        <TextField
          size="small"
          fullWidth
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clusters by fingerprint, kind, or title…"
          InputProps={{
            sx: { typography: "s2" },
            startAdornment: (
              <Box sx={{ pr: 0.75, pl: 0.25, display: "flex", color: "text.subtitle" }}>
                <Iconify icon="solar:magnifer-linear" width={14} />
              </Box>
            ),
          }}
          sx={{ flex: 1, minWidth: 240 }}
        />
        <Select
          size="small"
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          IconComponent={(p) => <Iconify {...p} icon="solar:alt-arrow-down-linear" width={12} />}
          renderValue={(v) => (
            <Stack direction="row" alignItems="center" spacing={0.75}>
              <Iconify icon="mage:filter" width={13} sx={{ color: "text.subtitle" }} />
              <Typography sx={{ typography: "s2", fontWeight: 600 }}>
                {v === "all" ? "Any severity" : v.charAt(0).toUpperCase() + v.slice(1)}
              </Typography>
            </Stack>
          )}
          sx={{
            minWidth: 148, flexShrink: 0,
            "& .MuiSelect-select": { py: 0.75, pr: "28px !important", pl: 1.25 },
            "& .MuiSelect-icon": { color: "text.subtitle", right: 8 },
          }}
        >
          <MenuItem value="all" sx={{ typography: "s2" }}>Any severity</MenuItem>
          <MenuItem value="high" sx={{ typography: "s2" }}>High</MenuItem>
          <MenuItem value="medium" sx={{ typography: "s2" }}>Medium</MenuItem>
          <MenuItem value="low" sx={{ typography: "s2" }}>Low</MenuItem>
        </Select>
        <Button
          variant="contained"
          color="primary"
          size="small"
          disabled={chosen.length === 0}
          onClick={commit}
          startIcon={<Iconify icon="solar:add-circle-linear" width={15} />}
          sx={{
            typography: "s2", fontWeight: 700, whiteSpace: "nowrap",
            flexShrink: 0, minWidth: 148, px: 2,
          }}
        >
          {scenarioCount > 0
            ? `Add ${scenarioCount} scenario${scenarioCount === 1 ? "" : "s"}`
            : "Add scenarios"}
        </Button>
      </Stack>

      {/* meta strip — quiet count on the left, bulk-action text-links on the right */}
      <Stack
        direction="row" alignItems="center"
        sx={{
          px: 2.5, py: 0.875, borderBottom: "1px solid", borderColor: "divider",
          flexShrink: 0,
        }}
      >
        <Typography sx={{ typography: "s3", color: "text.subtitle", flex: 1 }}>
          {query || severity !== "all"
            ? `${shown.length} of ${clusters.length} clusters`
            : `${clusters.length} cluster${clusters.length === 1 ? "" : "s"}`}
          {chosen.length > 0 && (
            <Box component="span" sx={{ color: "text.secondary", fontWeight: 600 }}>
              {" · "}{chosen.length} selected
              {" · "}{scenarioCount} scenario{scenarioCount === 1 ? "" : "s"}
            </Box>
          )}
        </Typography>
        <Button
          size="small" onClick={selectAll}
          disabled={importable.length === 0 || importable.every((c) => pickedCases(c).length === openCases(c).length)}
          sx={{
            typography: "s3", fontWeight: 700, color: "primary.main", minWidth: 0,
            "&.Mui-disabled": { color: "text.disabled" },
          }}
        >
          Select all
        </Button>
        {chosen.length > 0 && (
          <Button
            size="small" onClick={clear}
            sx={{ typography: "s3", fontWeight: 600, color: "text.secondary", minWidth: 0, ml: 0.5 }}
          >
            Clear
          </Button>
        )}
      </Stack>

      {/* table — mirrors the Error Feed table shape (checkbox · cluster · severity · kind · events · last seen · expand) */}
      {shown.length === 0 ? (
        <Box sx={{ px: 2.5, py: 6, textAlign: "center" }}>
          <Typography sx={{ typography: "s2", color: "text.subtitle" }}>
            No clusters match your filters.
          </Typography>
        </Box>
      ) : (
        <ClustersTable
          rows={shown}
          picked={picked}
          isAdded={isAdded}
          onToggleCluster={toggleCluster}
          onToggleCase={toggleCase}
        />
      )}
    </SectionCard>
  );
}

ProductionImport.propTypes = {
  env: PropTypes.object,
  onAdd: PropTypes.func,
  selected: PropTypes.array,
};

/* ── table ───────────────────────────────────────────────────────────────── */

const COLUMNS = [
  { id: "cluster",   label: "Cluster",   minWidth: 320 },
  { id: "severity",  label: "Severity",  width: 100 },
  { id: "kind",      label: "Kind",      width: 140 },
  { id: "traces",    label: "Traces",    width: 72,  align: "right" },
  {
    id: "scenarios", label: "Scenarios", width: 92, align: "right",
    hint: "One per distinct case. Traces that fail the same way in the same situation are the same test, so they become one scenario.",
  },
  { id: "lastSeen",  label: "Last seen", width: 110 },
];

const CHECKBOX_SX = {
  p: 0.5, color: "text.disabled",
  "&.Mui-checked": { color: "text.primary" },
  "&.MuiCheckbox-indeterminate": { color: "text.primary" },
};

/**
 * Deliberately shaped to mirror the Error Feed table (sticky compact
 * header, checkbox column, two-line cluster cell with a fingerprint
 * tag beneath the title, severity dot-badge, right-aligned event
 * count) — so the "From production" pane reads as the same object the
 * user sees in Observe, just filtered to what they can promote.
 */
function ClustersTable({ rows, picked, isAdded, onToggleCluster, onToggleCase }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";

  return (
    <TableContainer sx={{ flex: 1, minHeight: 0 }}>
      <Table stickyHeader size="small" sx={{ minWidth: 860 }}>
        <TableHead>
          <TableRow
            sx={{
              "& .MuiTableCell-head": {
                bgcolor: isDark ? "background.neutral" : "background.default",
                borderBottom: "1px solid", borderColor: "divider",
                py: 1.25, px: 1.5, whiteSpace: "nowrap",
              },
            }}
          >
            <TableCell padding="checkbox" sx={{ width: 40 }} />
            {COLUMNS.map((col) => (
              <TableCell
                key={col.id}
                align={col.align || "left"}
                sx={{ width: col.width, minWidth: col.minWidth }}
              >
                <Stack
                  direction="row" alignItems="center" spacing={0.5}
                  justifyContent={col.align === "right" ? "flex-end" : "flex-start"}
                >
                  <Typography sx={{ typography: "s3", fontWeight: 500, color: "text.secondary" }}>
                    {col.label}
                  </Typography>
                  {col.hint && (
                    <Tooltip title={col.hint} arrow placement="top">
                      <Box component="span" sx={{ display: "flex", color: "text.disabled", cursor: "help" }}>
                        <Iconify icon="solar:info-circle-linear" width={13} />
                      </Box>
                    </Tooltip>
                  )}
                </Stack>
              </TableCell>
            ))}
            <TableCell sx={{ width: 40 }} />
          </TableRow>
        </TableHead>

        <TableBody>
          {rows.map((c) => (
            <ClusterTableRow
              key={c.id}
              cluster={c}
              pickedMap={picked[c.id] || {}}
              isAdded={isAdded}
              onToggle={() => onToggleCluster(c)}
              onToggleCase={(k) => onToggleCase(c, k)}
            />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
ClustersTable.propTypes = {
  rows: PropTypes.array,
  picked: PropTypes.object,
  isAdded: PropTypes.func,
  onToggleCluster: PropTypes.func,
  onToggleCase: PropTypes.func,
};

function ClusterTableRow({ cluster, pickedMap, isAdded, onToggle, onToggleCase }) {
  const [open, setOpen] = useState(false);
  const c = cluster;
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";

  const remaining = c.cases.filter((k) => !isAdded(c, k));
  const addedCount = c.cases.length - remaining.length;
  const alreadyIn = remaining.length === 0;
  const pickedCount = remaining.filter((k) => pickedMap[k.id]).length;
  const allPicked = !alreadyIn && pickedCount === remaining.length;
  const somePicked = pickedCount > 0 && !allPicked;
  const rowSelected = pickedCount > 0;

  return (
    <>
      <TableRow
        hover
        selected={rowSelected}
        /* Clicking the row opens its detail; only the checkbox selects —
           so reading a cluster never quietly adds it. */
        onClick={() => setOpen((o) => !o)}
        sx={{
          cursor: "pointer",
          height: 56,
          "&.Mui-selected, &.Mui-selected:hover": {
            bgcolor: isDark ? "rgba(120,87,252,0.12)" : "rgba(120,87,252,0.05)",
          },
          "& .MuiTableCell-body": {
            borderBottom: "1px solid", borderColor: "divider",
            px: 1.5, py: 0,
          },
        }}
      >
        <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            size="small"
            checked={allPicked || alreadyIn}
            indeterminate={somePicked}
            disabled={alreadyIn}
            onChange={onToggle}
            sx={CHECKBOX_SX}
          />
        </TableCell>

        {/* cluster — title + fingerprint tag (mirrors the Error Feed's "Error name + type" cell) */}
        <TableCell>
          <Stack direction="column" spacing={0.5} justifyContent="center">
            <Tooltip title={c.title} placement="top-start" arrow>
              <Typography
                sx={{
                  typography: "s2", fontWeight: 500, color: "text.primary",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  maxWidth: 460,
                }}
              >
                {c.title}
              </Typography>
            </Tooltip>
            <Stack direction="row" alignItems="center" spacing={0.75}>
              <FingerprintTag value={c.fingerprint} isDark={isDark} />
              {c.critical && (
                <Typography
                  sx={{
                    fontSize: "10px", fontWeight: 700, letterSpacing: 0.4,
                    color: "#DB2F2D", textTransform: "uppercase",
                  }}
                >
                  Critical
                </Typography>
              )}
              {addedCount > 0 && (
                <Typography sx={{ typography: "s3", color: "text.disabled" }}>
                  {alreadyIn ? "· already added" : `· ${addedCount} of ${c.cases.length} already added`}
                </Typography>
              )}
            </Stack>
          </Stack>
        </TableCell>

        <TableCell><ErrorSeverityBadge severity={c.severity} /></TableCell>

        <TableCell>
          <KindPill label={c.kindLabel} color={c.kindColor} isDark={isDark} />
        </TableCell>

        <TableCell align="right">
          <Typography
            sx={{
              typography: "s2", fontWeight: 500, color: "text.primary",
              fontFeatureSettings: "'tnum'",
            }}
          >
            {c.count}
          </Typography>
        </TableCell>

        {/* how many scenarios this cluster turns into — "2 of 3" once you've
            dropped a case, so the count never hides a partial pick */}
        <TableCell align="right">
          <Typography
            sx={{
              typography: "s2", fontWeight: 500, fontFeatureSettings: "'tnum'",
              color: alreadyIn ? "text.disabled" : "text.primary",
            }}
          >
            {somePicked ? `${pickedCount} of ${remaining.length}` : remaining.length || c.cases.length}
          </Typography>
        </TableCell>

        <TableCell>
          <Typography sx={{ typography: "s3", color: "text.disabled" }} noWrap>
            {c.lastSeen}
          </Typography>
        </TableCell>

        <TableCell>
          <Tooltip title={open ? "Hide detail" : "Show detail"} arrow>
            <IconButton size="small">
              <Iconify
                icon={open ? "solar:alt-arrow-up-linear" : "solar:alt-arrow-down-linear"}
                width={14} sx={{ color: "text.subtitle" }}
              />
            </IconButton>
          </Tooltip>
        </TableCell>
      </TableRow>

      {/* full-width detail row — un-hoverable, no border above so it feels attached to the parent */}
      <TableRow
        sx={{
          "& .MuiTableCell-body": {
            borderBottom: open ? "1px solid" : "none",
            borderColor: "divider",
            p: 0,
          },
        }}
      >
        <TableCell colSpan={COLUMNS.length + 2} sx={{ py: "0 !important" }}>
          <Collapse in={open} unmountOnExit>
            <Stack spacing={1.5} sx={{ px: 6, py: 2, bgcolor: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)" }}>
              <Box>
                <Label>Why this fails</Label>
                <Typography sx={{ typography: "s2", color: "text.secondary" }}>{c.why}</Typography>
              </Box>
              <Box>
                <Stack direction="row" alignItems="baseline" spacing={0.75} sx={{ mb: 0.5 }}>
                  <Label sx={{ mb: 0 }}>
                    {`Becomes ${c.cases.length} scenario${c.cases.length === 1 ? "" : "s"}`}
                  </Label>
                  <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
                    {c.cases.length === 1
                      ? `— all ${c.count} traces failed in the same situation`
                      : `— one per distinct case across its ${c.count} traces`}
                  </Typography>
                </Stack>
                <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
                  {c.cases.map((k, i) => (
                    <CaseRow
                      key={k.id}
                      kase={k}
                      first={i === 0}
                      added={isAdded(c, k)}
                      picked={!!pickedMap[k.id]}
                      onToggle={() => onToggleCase(k)}
                    />
                  ))}
                </Box>
              </Box>
              <Box>
                <Label>Each one tests</Label>
                <Typography sx={{ typography: "s2", color: "text.primary" }}>{c.useCase}</Typography>
              </Box>
            </Stack>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}
ClusterTableRow.propTypes = {
  cluster: PropTypes.object,
  pickedMap: PropTypes.object,
  isAdded: PropTypes.func,
  onToggle: PropTypes.func,
  onToggleCase: PropTypes.func,
};

/**
 * One distinct case inside a cluster — what was different when it failed,
 * a line from one of its traces, and how many traces it covers. Each is
 * one scenario, and can be dropped without dropping the cluster.
 */
function CaseRow({ kase, first, added, picked, onToggle }) {
  return (
    <Stack
      direction="row" alignItems="center" spacing={1.25}
      sx={{
        px: 1, py: 0.75,
        borderTop: first ? "none" : "1px solid", borderColor: "divider",
      }}
    >
      {/* Same rule as the cluster rows: only the checkbox selects. */}
      <Checkbox
        size="small"
        checked={picked || added}
        disabled={added}
        onChange={onToggle}
        sx={CHECKBOX_SX}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ typography: "s2", fontWeight: 500, color: added ? "text.disabled" : "text.primary" }}>
          {kase.label}
        </Typography>
        <Typography
          noWrap
          sx={{ typography: "s3", fontFamily: "ui-monospace, Menlo, monospace", color: "text.subtitle" }}
        >
          {kase.quote}
        </Typography>
      </Box>
      <Typography
        sx={{ typography: "s3", color: "text.subtitle", fontFeatureSettings: "'tnum'", whiteSpace: "nowrap", flexShrink: 0 }}
      >
        {added ? "already added" : `${kase.traceCount} trace${kase.traceCount === 1 ? "" : "s"}`}
      </Typography>
    </Stack>
  );
}
CaseRow.propTypes = {
  kase: PropTypes.object,
  first: PropTypes.bool,
  added: PropTypes.bool,
  picked: PropTypes.bool,
  onToggle: PropTypes.func,
};

/**
 * Fingerprint tag — same visual treatment as the Error Feed's Error
 * Type tag (small neutral pill) so the two lists read alike.
 */
function FingerprintTag({ value, isDark }) {
  return (
    <Box
      sx={{
        display: "inline-flex", alignItems: "center",
        height: 18, borderRadius: "3px", px: "5px",
        bgcolor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)",
        color: isDark ? "#a1a1aa" : "#605C70",
        maxWidth: 260, overflow: "hidden",
      }}
    >
      <Typography
        sx={{
          fontSize: "10px", fontWeight: 500,
          fontFamily: "ui-monospace, Menlo, monospace",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}
FingerprintTag.propTypes = { value: PropTypes.string, isDark: PropTypes.bool };

/** Kind pill — tinted the same way the Error Feed's Fix Layer pill is. */
function KindPill({ label, color, isDark }) {
  return (
    <Box
      sx={{
        display: "inline-flex", alignItems: "center",
        px: "8px", py: "3px", borderRadius: "5px",
        bgcolor: isDark ? alpha(color, 0.16) : alpha(color, 0.1),
        border: "1px solid", borderColor: alpha(color, 0.35),
        whiteSpace: "nowrap",
      }}
    >
      <Typography sx={{ fontSize: "11px", fontWeight: 600, color, lineHeight: 1, letterSpacing: "0.01em" }}>
        {label}
      </Typography>
    </Box>
  );
}
KindPill.propTypes = { label: PropTypes.string, color: PropTypes.string, isDark: PropTypes.bool };

function Label({ children, sx }) {
  return (
    <Typography sx={{ typography: "s3", fontWeight: 700, color: "text.subtitle", textTransform: "uppercase", letterSpacing: .4, mb: 0.5, ...sx }}>
      {children}
    </Typography>
  );
}
Label.propTypes = { children: PropTypes.node, sx: PropTypes.object };
