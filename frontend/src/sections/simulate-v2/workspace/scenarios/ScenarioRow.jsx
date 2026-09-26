import PropTypes from "prop-types";
import { Box, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { PersonaBadge } from "../../components/primitives";

/*
  One compact scenario row, used by the add-scenario pickers. Lives in its
  own file (it used to be exported from ScenariosStep) so the pickers don't
  import the whole tab — that import made a cycle that stopped hot updates
  from reaching the page.
*/
export default function ScenarioRow({ row, index, onRemove, selectable, checked, onToggle }) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={2}
      sx={{
        px: 2.5, py: 1.5,
        cursor: selectable ? "pointer" : "default",
        "&:hover": selectable ? { bgcolor: "action.hover" } : {},
      }}
      onClick={selectable ? onToggle : undefined}
    >
      {selectable ? (
        <Iconify
          icon={checked ? "solar:check-square-bold" : "solar:stop-linear"}
          width={18}
          sx={{ color: checked ? "primary.main" : "text.subtitle", flexShrink: 0 }}
        />
      ) : (
        <Typography sx={{ typography: "s3", color: "text.subtitle", width: 20, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
          {index + 1}
        </Typography>
      )}

      <Box sx={{ flex: 1.4, minWidth: 0 }}>
        <Stack direction="row" alignItems="center" spacing={0.75}>
          <Typography noWrap sx={{ typography: "s2", fontWeight: 600 }}>{row.title}</Typography>
          {row.critical && (
            <Tooltip title="Critical — a failure here is a release blocker" arrow>
              <Box sx={{ display: "flex" }}>
                <Iconify icon="solar:danger-triangle-bold" width={13} sx={{ color: "#DC2626" }} />
              </Box>
            </Tooltip>
          )}
        </Stack>
        <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>{row.task}</Typography>
      </Box>

      {/* Wide enough for a full job title — roles were truncating at 180. */}
      <Box sx={{ width: 240, flexShrink: 0, display: { xs: "none", md: "block" } }}>
        <PersonaBadge persona={row.persona} compact />
      </Box>

      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ width: 62, flexShrink: 0, display: { xs: "none", sm: "flex" } }}>
        <Iconify icon="solar:chat-round-line-linear" width={13} sx={{ color: "text.subtitle" }} />
        <Typography sx={{ typography: "s3", color: "text.subtitle" }}>~{row.turns}</Typography>
      </Stack>

      {onRemove && (
        <IconButton size="small" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
          <Iconify icon="solar:close-circle-linear" width={16} sx={{ color: "text.subtitle" }} />
        </IconButton>
      )}
    </Stack>
  );
}
ScenarioRow.propTypes = {
  row: PropTypes.object, index: PropTypes.number, onRemove: PropTypes.func,
  selectable: PropTypes.bool, checked: PropTypes.bool, onToggle: PropTypes.func,
};
