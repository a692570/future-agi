import PropTypes from "prop-types";
import { Box, Tooltip } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { ensureProvenance, provenanceLabel, sourceOf } from "../../_mock/scenarioProvenance";

/**
 * Provenance form on a scenario row — the visual mark that PRD §6.1.2
 * mandates. Three variants:
 *   - "user"      → filled amber square  ("you started this")
 *   - "auto"      → hollow ring           ("we started this")
 *   - "assistant" → filled green dot     ("the assistant did this")
 * Hover tooltip carries the full attribution.
 */
export default function ProvenanceGlyph({ scenario, size = 10 }) {
  const s = ensureProvenance(scenario);
  const src = sourceOf(s.source);
  const label = provenanceLabel(s);
  return (
    <Tooltip title={`${src.label} · ${label}`} arrow>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, flexShrink: 0 }}>
        {src.formKind === "user" && (
          <Box sx={{
            width: size, height: size, borderRadius: 0.375,
            bgcolor: "#F59E0B",
          }} />
        )}
        {src.formKind === "auto" && (
          <Box sx={{
            width: size, height: size, borderRadius: "50%",
            border: "1.5px solid",
            borderColor: (t) => alpha(t.palette.text.primary, 0.35),
          }} />
        )}
        {src.formKind === "assistant" && (
          <Box sx={{
            width: size, height: size, borderRadius: "50%",
            bgcolor: "#16A34A",
          }} />
        )}
      </Box>
    </Tooltip>
  );
}
ProvenanceGlyph.propTypes = { scenario: PropTypes.object, size: PropTypes.number };
