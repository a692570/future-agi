import PropTypes from "prop-types";
import { Box, Stack, Typography } from "@mui/material";
import { SectionCard } from "../components/primitives";
import { agentVersions, currentAgentVersion } from "../_mock/versions";
import { toolCallers, toolFit, toolSince } from "../_mock/toolFit";
import CapabilityGraph from "./CapabilityGraph";
import { TwinSandboxSection } from "./OverviewPanel";
import WorldInternalsSection from "./WorldInternalsSection";
import ToolFitBanner from "./ToolFitBanner";

/**
 * The world — the data and tool answers a run executes against.
 *
 * Separate from the contract on purpose. The contract is the rules (how a run
 * ends, who else acts in it); the world is what the agent talks to. The world
 * is also the part that grows: it was first built to answer the tools of the
 * agent version the environment was made from, and it learns a new tool each
 * time a later version brings one.
 */

const COLS = "minmax(160px, 1.1fr) minmax(0, 2fr) 96px minmax(120px, 1fr)";

function VersionTag({ label, dim }) {
  return (
    <Box
      component="span"
      sx={{
        px: 0.625, height: 18, display: "inline-flex", alignItems: "center", borderRadius: 0.5,
        border: "1px solid", borderColor: "divider", typography: "s3", fontWeight: 600,
        color: dim ? "text.disabled" : "text.secondary", fontVariantNumeric: "tabular-nums",
      }}
    >
      {label}
    </Box>
  );
}
VersionTag.propTypes = { label: PropTypes.string, dim: PropTypes.bool };

export default function WorldPanel({ env, envState, patch, onGo }) {
  const fit = toolFit(env, envState);
  const since = toolSince(env, envState);
  const callers = toolCallers(env, envState);
  const activeAgent = currentAgentVersion(envState)?.label;
  const versionsCount = agentVersions(envState).length;

  const rows = [
    ...fit.world.map((t) => ({ tool: t, answered: true })),
    ...fit.missing.map((t) => ({ tool: t, answered: false })),
  ];

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ mb: 2 }}>
        <Typography sx={{ typography: "m2", fontWeight: 600 }}>World</Typography>
        <Typography sx={{ typography: "s2", color: "text.secondary", maxWidth: 780 }}>
          What your agent talks to during a run — the data, and an answer for every tool call. It was built
          from your first agent version, and it learns a new tool whenever a later version brings one.
        </Typography>
      </Box>

      <ToolFitBanner env={env} envState={envState} patch={patch} sx={{ mb: 2 }} />

      <SectionCard
        title={`Tools this world can answer · environment ${fit.envVersion}`}
        subtitle={
          fit.fits
            ? `Agent ${activeAgent} calls ${fit.calls.length} tools — the world answers every one.`
            : `Agent ${activeAgent} calls ${fit.missing.length === 1 ? "one tool" : `${fit.missing.length} tools`} the world can't answer yet.`
        }
        sx={{ mb: 2 }}
      >
        <Box
          sx={{
            display: "grid", gridTemplateColumns: COLS, columnGap: 2, px: 2.5, py: 1,
            borderBottom: "1px solid", borderColor: "divider",
          }}
        >
          {["Tool", "What it does", "Since", versionsCount > 1 ? "Called by" : "Called by agent"].map((h) => (
            <Typography key={h} sx={{ typography: "s3", fontWeight: 600, color: "text.subtitle" }}>{h}</Typography>
          ))}
        </Box>
        <Stack divider={<Box sx={{ borderBottom: "1px solid", borderColor: "divider" }} />}>
          {rows.map(({ tool, answered }) => (
            <Box
              key={tool.name}
              sx={{
                display: "grid", gridTemplateColumns: COLS, columnGap: 2, alignItems: "center",
                px: 2.5, py: 1.125,
                ...(!answered && { bgcolor: "action.hover" }),
              }}
            >
              <Typography noWrap sx={{ typography: "s2", fontWeight: 600, fontFamily: "ui-monospace, Menlo, monospace" }}>
                {tool.name}
              </Typography>
              <Typography noWrap sx={{ typography: "s2", color: "text.secondary" }}>{tool.desc}</Typography>
              <Box>
                {answered
                  ? <VersionTag label={`env ${since[tool.name] || fit.envVersion}`} />
                  : <Typography sx={{ typography: "s3", fontWeight: 700 }}>Not yet</Typography>}
              </Box>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" rowGap={0.5}>
                {(callers[tool.name] || []).map((v) => <VersionTag key={v} label={v} />)}
                {!(callers[tool.name] || []).length && (
                  <Typography sx={{ typography: "s3", color: "text.disabled" }}>No version calls it</Typography>
                )}
              </Stack>
            </Box>
          ))}
        </Stack>
      </SectionCard>

      {envState?.twinBacking && (
        <Box sx={{ mb: 2 }}>
          <TwinSandboxSection env={env} envState={envState} />
        </Box>
      )}
      {!envState?.twinBacking && (envState?.agent || (env.tools?.length || 0) > 0) && (
        <Box sx={{ mb: 2 }}>
          <CapabilityGraph env={env} envState={envState} onGo={onGo} />
        </Box>
      )}

      <WorldInternalsSection env={env} envState={envState} patch={patch} />
    </Box>
  );
}

WorldPanel.propTypes = {
  env: PropTypes.object.isRequired,
  envState: PropTypes.object.isRequired,
  patch: PropTypes.func,
  onGo: PropTypes.func,
};
