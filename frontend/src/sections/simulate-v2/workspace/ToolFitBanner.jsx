import PropTypes from "prop-types";
import { Box, Button, Stack, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { currentAgentVersion } from "../_mock/versions";
import { latestEnvVersion, toolFit } from "../_mock/toolFit";
import { toolList, useRebuildForAgent } from "./toolFitParts";

/**
 * "Can the agent you are about to test actually be tested here?"
 *
 * Only one answer needs saying: it calls a tool this world cannot answer —
 * rebuild, or switch to the environment version that already learned it.
 * A newer agent that calls the same tools just plugs in; there is nothing to
 * rebuild, so nothing is shown.
 */


export default function ToolFitBanner({ env, envState, patch, sx }) {
  const rebuild = useRebuildForAgent(env, envState, patch);
  const agentV = currentAgentVersion(envState);
  if (!agentV) return null;

  const fit = toolFit(env, envState);
  const latest = latestEnvVersion(env, envState);
  const latestFits = latest && latest.label !== fit.envVersion
    && toolFit(env, envState, { envVersion: latest.label }).fits;
  if (fit.fits) return null;

  const n = fit.missing.length;

  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      alignItems={{ sm: "center" }}
      spacing={1.5}
      sx={{
        p: 1.75, borderRadius: 1.5, border: "1px solid", borderColor: "text.disabled",
        bgcolor: "background.neutral",
        ...sx,
      }}
    >
      <Iconify
        icon="solar:plug-circle-linear"
        width={20}
        sx={{ color: "text.primary", flexShrink: 0 }}
      />
      <Box flex={1} minWidth={0}>
        <Typography sx={{ typography: "s2", fontWeight: 700 }}>
          {`Agent ${agentV.label} calls ${n === 1 ? "a tool" : `${n} tools`} environment ${fit.envVersion} can't answer`}
        </Typography>
        <Typography component="div" sx={{ typography: "s3", color: "text.subtitle", mt: 0.25 }}>
          {latestFits ? (
            <>
              {toolList(fit.missing)} {n === 1 ? "is" : "are"} new in {agentV.label}. Environment {latest.label} already
              answers {n === 1 ? "it" : "them"} — switch to it for a clean run of {agentV.label}.
            </>
          ) : (
            <>
              {toolList(fit.missing)} {n === 1 ? "is" : "are"} new in {agentV.label}. Rebuild so the world learns{" "}
              {n === 1 ? "it" : "them"} — until then, scenarios where {agentV.label} calls {n === 1 ? "it" : "them"} here
              get no answer and come back not measured.
            </>
          )}
        </Typography>
      </Box>
      <Button
        variant="contained"
        color="primary"
        size="small"
        onClick={() => (latestFits ? patch({ activeEnvVersion: latest.label }) : rebuild(agentV.label))}
        startIcon={<Iconify icon={latestFits ? "solar:transfer-horizontal-linear" : "solar:refresh-linear"} width={14} />}
        sx={{
          flexShrink: 0, typography: "s2", fontWeight: 700,
        }}
      >
        {latestFits ? `Use environment ${latest.label}` : "Rebuild environment"}
      </Button>
    </Stack>
  );
}

ToolFitBanner.propTypes = {
  env: PropTypes.object,
  envState: PropTypes.object,
  patch: PropTypes.func,
  sx: PropTypes.object,
};
