import PropTypes from "prop-types";
import { useCallback } from "react";
import { useSnackbar } from "notistack";
import { Box } from "@mui/material";
import { rebuildForAgent } from "../_mock/toolFit";

/* Small shared pieces for anything that talks about tools and fit. */

export const Mono = ({ children }) => (
  <Box
    component="span"
    sx={{
      fontFamily: "ui-monospace, Menlo, monospace", fontSize: "0.92em", fontWeight: 600,
      px: 0.5, py: "1px", borderRadius: 0.5, bgcolor: "action.hover", color: "text.primary",
    }}
  >
    {children}
  </Box>
);
Mono.propTypes = { children: PropTypes.node };

export const toolList = (tools) => tools.map((t, i) => (
  <Box component="span" key={t.name}>
    {i > 0 && (i === tools.length - 1 ? " and " : ", ")}
    <Mono>{t.name}</Mono>
  </Box>
));

/** Rebuild the environment for an agent version, and say what changed. */
export function useRebuildForAgent(env, envState, patch) {
  const { enqueueSnackbar } = useSnackbar();
  return useCallback((agentLabel) => {
    const { version, added, patch: next } = rebuildForAgent(env, envState, agentLabel);
    patch(next);
    const learned = [...new Set(added.map((r) => r.newTool))];
    enqueueSnackbar(
      learned.length
        ? `Environment ${version.label} is ready — the world now answers ${learned.join(", ")}, and ${added.length} new scenarios test ${learned.length === 1 ? "it" : "them"}.`
        : `Environment ${version.label} is ready — re-derived against agent ${agentLabel}.`,
      { variant: "success", autoHideDuration: 5000 },
    );
    return version;
  }, [env, envState, patch, enqueueSnackbar]);
}

