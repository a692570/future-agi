import PropTypes from "prop-types";
import { alpha } from "@mui/material/styles";
import { Box, Stack, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { SectionCard } from "../components/primitives";
import { episodeContract } from "../_mock/rlContract";
import ActorsPanel from "./ActorsPanel";

/**
 * The environment contract — what this environment IS.
 *
 * Concrete over formal: the world (twin sandbox or capability graph),
 * the internals a run reads from (DB schema, tool code, check code),
 * how a run ends, and who else acts in it. The five-part RL-textbook
 * framing that used to live here — modality adapter, obs/action spaces,
 * transition dynamics, reward spec — mostly duplicated other tabs in
 * RL notation. Removed so the tab reads as "what this env is made of"
 * rather than "our RL spec, restated". The RL vocabulary lives in
 * `_mock/rlContract.js` if it needs to come back behind a toggle.
 */
export default function RlContractPanel({ env, envState, patch, onGo }) {
  const episode = episodeContract(env, envState);

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ mb: 2 }}>
        <Typography sx={{ typography: "m2", fontWeight: 600 }}>Environment contract</Typography>
        <Typography sx={{ typography: "s2", color: "text.secondary", maxWidth: 780 }}>
          The rules of this environment — how each run ends, and who else acts in it. The data and tools
          the agent talks to live on the World tab.
        </Typography>
      </Box>

      {/* ── run end conditions ────────────────────────────────────────── */}
      <SectionCard
        title="Run end conditions"
        subtitle="When a run is over, and which kind of over it was"
        sx={{ mb: 2 }}
      >
        <Box sx={{
          display: "grid", gap: "1px",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          bgcolor: (t) => alpha(t.palette.text.primary, t.palette.mode === "dark" ? 0.09 : 0.07),
        }}>
          <Box sx={{ p: 2.5, bgcolor: "background.paper" }}>
            <Label>Terminate</Label>
            <Typography sx={{ typography: "s3", color: "text.subtitle", mb: 1.25 }}>
              The episode has a value. Goal verifiers settle.
            </Typography>
            <Stack spacing={1}>
              {episode.terminate.map((e) => (
                <Box key={e.when}>
                  <Typography sx={{ typography: "s2", fontWeight: 600 }}>{e.when}</Typography>
                  <Typography sx={{ typography: "s3", color: "text.subtitle" }}>{e.note}</Typography>
                </Box>
              ))}
            </Stack>
          </Box>
          <Box sx={{ p: 2.5, bgcolor: "background.paper" }}>
            <Label>Truncate</Label>
            <Typography sx={{ typography: "s3", color: "text.subtitle", mb: 1.25 }}>
              Not a failure, and not terminal — bootstrap from the last state.
            </Typography>
            <Stack spacing={1}>
              {episode.truncate.map((e) => (
                <Box key={e.when}>
                  <Typography sx={{ typography: "s2", fontWeight: 600 }}>{e.when}</Typography>
                  <Typography sx={{ typography: "s3", color: "text.subtitle" }}>{e.note}</Typography>
                </Box>
              ))}
            </Stack>
          </Box>
        </Box>
        <Stack divider={<Box sx={{ borderBottom: "1px solid", borderColor: "divider" }} />} sx={{ borderTop: "1px solid", borderColor: "divider" }}>
          <Stack direction="row" spacing={1.75} sx={{ px: 2.5, py: 1.75 }} alignItems="flex-start">
            <Iconify icon="solar:clock-circle-linear" width={16} sx={{ color: "text.subtitle", flexShrink: 0, mt: "1px" }} />
            <Box>
              <Typography sx={{ typography: "s2", fontWeight: 700 }}>Clock · {episode.clock.mode}</Typography>
              <Typography sx={{ typography: "s2", color: "text.secondary" }}>{episode.clock.note}</Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={1.75} sx={{ px: 2.5, py: 1.75 }} alignItems="flex-start">
            <Iconify icon="solar:dice-linear" width={16} sx={{ color: "text.subtitle", flexShrink: 0, mt: "1px" }} />
            <Box>
              <Typography sx={{ typography: "s2", fontWeight: 700 }}>Deterministic seed</Typography>
              <Typography sx={{ typography: "s2", color: "text.secondary" }}>{episode.seed.note}</Typography>
            </Box>
          </Stack>
        </Stack>
      </SectionCard>

      {/*
        Actors — third parties with competing goals (a colleague who wants
        pizza, an angry passenger). They're distinct from personas (who the
        agent serves) and don't live on any other tab, so they stay here as
        part of "who else acts in this environment".
      */}
      {patch && (
        <ActorsPanel env={env} envState={envState} patch={patch} onGo={onGo} />
      )}
    </Box>
  );
}

RlContractPanel.propTypes = {
  env: PropTypes.object.isRequired,
  envState: PropTypes.object.isRequired,
  patch: PropTypes.func,
  onGo: PropTypes.func,
};

function Label({ children }) {
  return (
    <Typography sx={{ typography: "s3", fontWeight: 700, color: "text.subtitle", textTransform: "uppercase", letterSpacing: .4, mb: 1 }}>
      {children}
    </Typography>
  );
}
Label.propTypes = { children: PropTypes.node };
