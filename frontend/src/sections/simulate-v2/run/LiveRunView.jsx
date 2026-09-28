import PropTypes from "prop-types";
import { useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  Box, Stack, Typography, Button, IconButton, Tooltip, LinearProgress,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import Iconify from "src/components/iconify";
import { paths } from "src/routes/paths";
import RunResults from "./RunResults";
import { publishRun, installMockExecutionAdapter } from "../_mock/executionAdapter";
import { rebuildRun, TRIAL_CHANGES } from "../_mock/comparison";
import { agentVersions, currentAgentVersion, currentEnvVersion, environmentVersions } from "../_mock/versions";
import { runInputs, scenariosInEnvVersion, toolFit } from "../_mock/toolFit";
import { twinTimelineFor } from "../_mock/twins";
import { getEnvironment } from "../_mock/environments";
import { getSurface } from "../_mock/surfaces";
import { getEval, resolveEval } from "../_mock/evals";
import { BOOT_STEPS } from "../_mock/runStream";
import { SHADOW_SUMMARY } from "../_mock/sandbox";
import { useSimStore, useEnvState } from "../store";
import {
  StatusDot, StatusChip, ScorePill, EmptyState, pulse,
} from "../components/primitives";
import { ProvisioningPanel } from "../components/loading";
import useRunPlayer from "./useRunPlayer";
import Stage from "./stages";
import { gradedRuleIds } from "../_mock/provenance";
import { admissionOf } from "../_mock/coverage";
import { subTasksFor } from "../_mock/contract";
import BlockerFlag from "../workspace/scenarios/BlockerFlag";
import { milestoneOf } from "../_mock/runScripts";

const FLAKY = "#D97706";
const UNMEASURED = "#9AA0A6";
const RED = "#DC2626";

/* Why a scenario can't be run on this world, or null when it can. Only proved
   scenarios are ever run — the rest are listed as skipped, not run and then
   written off as "not measured". */
const skipReasonFor = (sc, envLabel) => {
  if (sc.provedBroke && (!sc.brokeAgainst || !envLabel || sc.brokeAgainst === envLabel)) {
    return "Its proof broke when the environment changed. Re-prove it to run it again.";
  }
  const adm = admissionOf(sc);
  return adm.admitted ? null : `Quarantined — ${adm.reason}`;
};

/**
 * The live run.
 *
 * Three columns: what is queued, what is happening right now, and what the
 * graders think of it. The middle column is the point of the whole screen —
 * a user should be able to leave this open on a second monitor and understand
 * their agent's behaviour without reading a single log line.
 */
export default function LiveRunView() {
  const { envId, runId } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { state } = useSimStore();
  const { envState, recordRun } = useEnvState(envId);

  const env = getEnvironment(envId) || state.myEnvironments.find((e) => e.id === envId);
  const surface = getSurface(env?.surface);

  const evals = useMemo(
    () => envState.evals.map(resolveEval).filter(Boolean),
    [envState.evals],
  );

  /*
    A run is not always a run of everything. `?only=` carries the subset a
    comparison sent here — re-run these four blockers against the new version —
    and the run records what it actually covered, so nothing downstream reads a
    four-scenario check as a full sweep that lost twenty-eight rows.
  */
  const only = params.get("only");
  /* `?agent=` runs a specific agent version — how a comparison re-runs v1 on
     the environment v2 was rebuilt for. Otherwise the current one. */
  const agentParam = params.get("agent");
  const runAgent = agentParam && agentVersions(envState).some((v) => v.label === agentParam)
    ? agentParam
    : currentAgentVersion(envState).label;
  /* `?env=` runs on a specific environment version without moving the
     environment's own pin — how Compare re-runs an older agent on the newer
     world. Otherwise the pinned one. */
  const envParam = params.get("env");
  const runEnv = envParam && environmentVersions(env, envState).some((v) => v.label === envParam)
    ? envParam
    : currentEnvVersion(env, envState)?.label;
  /* Only the scenarios that exist in this environment version — ones a later
     rebuild added for a tool this world never learned are not part of it. */
  const { scenarios, skipped, poolSize } = useMemo(() => {
    const inVersion = scenariosInEnvVersion(envState, runEnv);
    let pool = inVersion;
    if (only) {
      const wanted = new Set(only.split(","));
      const subset = inVersion.filter((sc) => wanted.has(sc.id));
      pool = subset.length ? subset : inVersion;
    }
    const run = [];
    const skip = [];
    pool.forEach((sc) => {
      const why = skipReasonFor(sc, runEnv);
      if (why) skip.push({ ...sc, skipReason: why });
      else run.push(sc);
    });
    return { scenarios: run, skipped: skip, poolSize: inVersion.length };
    /* Keyed on the scenario list, not the whole env state — recording the run
       itself updates the env state, and must not rebuild the run mid-flight. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [only, envState.scenarios, runEnv]);
  /* A re-run of some scenarios, not the whole set. */
  const partial = !!only && scenarios.length + skipped.length < poolSize;

  /*
    Trials per scenario (PRD §10.2 AC-10.7 — reliability across
    repeated trials). The Scenarios SelectionBar sets it via the
    `?trials=` param; when absent, we keep the historical 3, the
    smallest n where "passed twice, failed once" is sayable.
    Clamped 1–20 so a bad URL can't blow up the batch.
  */
  const repeats = (() => {
    const raw = Number(params.get("trials"));
    if (!Number.isFinite(raw) || raw < 1) return 3;
    return Math.min(20, Math.floor(raw));
  })();

  /* What the outcome depends on — the agent version and the environment
     version this run pins — read exactly as a later replay reads them.
     Memoised: the player rebuilds the run whenever its inputs change identity. */
  const inputs = useMemo(
    () => runInputs(env, envState, { agent: runAgent, envVersion: runEnv }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [env, runAgent, runEnv, envState.envVersions, envState.agentVersions, envState.actors],
  );

  const player = useRunPlayer({
    seed: runId,
    scenarios,
    stage: surface.stage,
    evals,
    repeats,
    ...inputs,
  });

  const {
    phase, start, finishNow, tasks, focus, focusId, setFocusId, stats, elapsed,
    sinceLastEvent, stalled,
  } = player;

  /*
    A run that is already in history is being read, not run. Replaying it —
    provisioning animation and all — was the old behaviour and it is wrong
    twice over: it wastes the reader's time, and it invites the suspicion that
    the numbers are generated fresh each time rather than being that run's.

    The latch matters because a run finishing puts itself into history: without
    it, the live view would flip to read-only in the same commit that finished
    it.
  */
  /*
    Trial rehydration.

    A trial id is `${OPT-XXXXX}-t${n}` — a self improvement's trial, which
    is a real simulation run (the search executed the candidate against
    this environment). If the URL points at one, look it up in the
    environment's optimizations rather than expecting a matching row in
    envState.runs (trials are not stored there — they are derived).
  */
  const trialMatch = useMemo(() => {
    const m = /^(OPT-\d+)-t(\d+)$/.exec(runId || "");
    if (!m) return null;
    const opt = (envState.optimizations || []).find((o) => o.id === m[1]);
    if (!opt) return null;
    const trial = (opt.result?.trials || []).find((t) => t.n === Number(m[2]));
    if (!trial) return null;
    const sourceRun = (envState.runs || []).find((r) => r.id === opt.fromRunId);
    return { opt, trial, sourceRun };
  }, [runId, envState.optimizations, envState.runs]);

  const stored = trialMatch
    /* Synthesize a stored-like record pointing at the source run's seed so
       rebuildRun can produce a task list. The trial's per-scenario outcomes
       are folded in below. */
    ? {
        id: trialMatch.sourceRun?.id || runId,
        agentVersion: trialMatch.sourceRun?.agentVersion || "trial",
        envVersion: trialMatch.sourceRun?.envVersion,
        scenarioIds: trialMatch.sourceRun?.scenarioIds
          || Object.keys(trialMatch.trial.perScenario || {}),
        repeats: trialMatch.sourceRun?.repeats || 1,
      }
    : envState.runs.find((r) => r.id === runId);

  const wasLive = useRef(false);
  useEffect(() => {
    if (phase === "running") wasLive.current = true;
  }, [phase]);
  /* Trials are always read-only: the search already ran them. */
  const readOnly = !!trialMatch || (!wasLive.current && !!stored);

  const storedTasks = useMemo(() => {
    if (!readOnly || !env || !stored) return [];
    const base = rebuildRun(env, envState, stored);
    if (!trialMatch) return base;
    /*
      Overlay the trial's per-scenario verdicts. The source run's traces are
      what a trial's run would have looked like; the trial's outcomes are
      what actually happened. Everything a reader clicks — Traces, Analytics,
      Verify — reads a run whose numbers match the trial score.
    */
    const per = trialMatch.trial.perScenario || {};
    return base.map((task) => {
      const outcome = per[task.scenarioId] || per[task.id];
      /* Only what the trial changed moves; unchanged scenarios keep their
         own outcome (passing, flaky or failing). */
      if (!outcome || !TRIAL_CHANGES[outcome]) return task;
      const passed = TRIAL_CHANGES[outcome] === "passed";
      return {
        ...task,
        status: passed ? "passed" : "failed",
        verdict: passed ? "passed" : "failed",
        passShare: passed ? 1 : 0,
      };
    });
  }, [readOnly, env, envState, stored, trialMatch]);

  const storedStats = useMemo(() => {
    const passed = storedTasks.filter((t) => t.status === "passed").length;
    const failed = storedTasks.filter((t) => t.status === "failed").length;
    const flaky = storedTasks.filter((t) => t.status === "flaky").length;
    const unmeasured = storedTasks.filter((t) => t.status === "unmeasured").length;
    const measured = storedTasks.filter((t) => t.status !== "unmeasured");
    return {
      total: storedTasks.length,
      passed,
      failed,
      flaky,
      unmeasured,
      measured: measured.length,
      repeats: stored?.repeats || 1,
      /* Same rule as the live run: the mean of the per-scenario proportions,
         over the scenarios that produced one. */
      passRate: measured.length
        ? measured.reduce((a, t) => a + (t.passShare ?? (t.status === "passed" ? 1 : 0)), 0) / measured.length
        : 0,
      tokens: storedTasks.reduce((a, t) => a + (t.tokens || 0), 0),
      cost: storedTasks.reduce((a, t) => a + (t.cost || 0), 0),
    };
  }, [storedTasks, stored]);


  /*
    Finishing hands the run to the execution-detail screen and goes there.

    That screen is real product code and fetches everything it renders, so the
    run is published to the mock adapter first — the adapter answers those
    fetches for this run id and passes every other request through untouched.
    Publishing before navigating matters: the screen's first query fires on
    mount, and an empty answer would be cached.
  */
  useEffect(() => {
    if (phase !== "done") return;
    installMockExecutionAdapter();
    publishRun(runId, { tasks, startedAt: new Date(Date.now() - elapsed).toISOString() });
  }, [phase, runId, tasks, elapsed]);

  /*
    Record the run as soon as the simulation actually starts (phase
    transitions from "booting" to "running") so it appears in the env's
    Run history and the Simulated Runs list immediately — even if the
    user navigates away or closes the tab before it completes. The
    reducer is upsert-by-id, so the finaliser effect below merges the
    completion stats into this same row.
  */
  const startedRef = useRef(false);
  useEffect(() => {
    if (phase !== "running" || startedRef.current) return;
    if (envState.runs.some((r) => r.id === runId)) {
      startedRef.current = true;
      return;
    }
    startedRef.current = true;
    const totalTasks = tasks.length || scenarios.length * repeats;
    recordRun({
      id: runId,
      label: only
        ? `${totalTasks} scenario${totalTasks === 1 ? "" : "s"} re-run`
        : `${env?.name} · ${totalTasks} tasks`,
      status: "running",
      startedAt: new Date().toISOString(),
      total: totalTasks,
      passed: 0,
      failed: 0,
      flaky: 0,
      unmeasured: 0,
      agentVersion: runAgent,
      envVersion: runEnv,
      /* Run anyway on a world that can't answer some of the agent's tools —
         recorded; calls to them come back as not measured. */
      toolGap: toolFit(env, envState, { agent: runAgent, envVersion: runEnv }).missing.map((t) => t.name),
      /* The graders applied when it ran — a later eval change must not
         regrade history. */
      evals: envState.evals,
      /* And the rules that graded it — confirming a held rule later changes
         the test, and Compare needs to be able to say so. */
      rules: gradedRuleIds(env, envState),
      /* And the cast of actors it ran with. */
      actors: inputs.actors.map((a) => a.id),
      scenarioIds: scenarios.map((sc) => sc.id),
      /* Left out because they aren't proved on this world. */
      skippedIds: skipped.map((sc) => sc.id),
      repeats,
      partial: !!only,
      ordinal: Math.max(0, ...(envState.runs || []).map((r) => r.ordinal || 0)) + 1,
      seed: runId,
      twinWrites: null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, runId]);

  /* Merge the completion stats into the run row when it finishes.
     Ordinal, agentVersion, envVersion, scenarioIds, repeats and the
     seed were already stamped by the start effect above — the upsert
     reducer preserves them. This write only overwrites the fields that
     genuinely change at completion (status, finishedAt, counts, twin
     writes, and the label to match the final task count). */
  useEffect(() => {
    if (phase !== "done") return;
    recordRun({
      id: runId,
      label: only
        ? `${stats.total} scenario${stats.total === 1 ? "" : "s"} re-run`
        : `${env?.name} · ${stats.total} tasks`,
      /* A run where nothing could be measured passed nothing. */
      status: stats.total - stats.unmeasured > 0 && stats.failed === 0 && !stats.flaky ? "passed" : "failed",
      finishedAt: new Date().toISOString(),
      total: stats.total,
      passed: stats.passed,
      failed: stats.failed,
      flaky: stats.flaky,
      unmeasured: stats.unmeasured,
      twinWrites: envState.twinBacking
        ? tasks.reduce((sum, task) => {
            const t = twinTimelineFor(envState, task);
            return sum + Object.values(t.writesByService).reduce((a, b) => a + b, 0);
          }, 0)
        : null,
    });
  }, [phase, runId, env, envState, stats, scenarios, only, recordRun]);

  /*
    A finished run goes to the summary, not to its own results. On its own a
    result page answers "how did that go"; the question someone has after
    changing their agent and running again is whether it moved, and only the
    list of runs can answer that. The run just finished is the top row there,
    one click from everything this screen used to show.
  */
  useEffect(() => {
    if (phase !== "done" || readOnly) return;
    navigate(paths.dashboard.simulate.environmentStep(envId, "runs"), { replace: true });
  }, [phase, readOnly, navigate, envId]);

  if (!env) {
    /* Wait for hydration before declaring the env missing — a custom env
       exists only in the cached myEnvironments, which is empty until the
       store loads (and reloads on every HMR patch while editing). */
    if (!state.hydrated) {
      return <Box sx={{ p: 2, height: "100%", minHeight: 420, display: "grid", placeItems: "center" }} />;
    }
    return (
      <Box sx={{ p: 2 }}>
        <EmptyState
          icon="solar:danger-triangle-linear"
          title="Environment not found"
          action={
            <Button variant="contained"
            color="primary" size="small" onClick={() => navigate(paths.dashboard.simulate.environments)}>
              Back to environments
            </Button>
          }
        />
      </Box>
    );
  }

  if (envState.scenarios.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <EmptyState
          icon="solar:layers-minimalistic-linear"
          title="Nothing to run"
          body="This environment has no scenarios selected yet."
          action={
            <Button
              variant="contained"
            color="primary" size="small"
              onClick={() => navigate(paths.dashboard.simulate.environmentStep(envId, "scenarios"))}
            >
              Add scenarios
            </Button>
          }
        />
      </Box>
    );
  }

  if (!readOnly && scenarios.length === 0 && skipped.length) {
    return (
      <Box sx={{ p: 2 }}>
        <EmptyState
          icon="solar:shield-cross-linear"
          title="Nothing proved to run"
          body={`All ${skipped.length} scenario${skipped.length === 1 ? " needs" : "s need"} re-proving on environment ${runEnv} before a run can give them a verdict.`}
          action={
            <Button
              variant="contained" color="primary" size="small"
              onClick={() => navigate(paths.dashboard.simulate.environmentStep(envId, "scenarios"))}
            >
              Go to scenarios
            </Button>
          }
        />
      </Box>
    );
  }

  /* ── a finished run, read back ── */
  if (readOnly) {
    return (
      <RunResults
        env={env}
        runId={runId}
        tasks={storedTasks}
        stats={storedStats}
        evals={evals}
        stage={surface.stage}
      />
    );
  }

  /* ── pre-run provisioning ── */
  if (phase === "booting") {
    return (
      <Box sx={{ p: 2, height: "100%", minHeight: 420, display: "grid", placeItems: "center" }}>
        <Box sx={{ width: "100%", maxWidth: 560, border: "1px solid", borderColor: "divider", borderRadius: 2, bgcolor: "background.paper" }}>
          <ProvisioningPanel
            icon={surface.icon}
            accent={surface.color}
            title="Preparing the simulation"
            /* What this run is actually about to do — a re-run of four
               scenarios is not "17 tasks", and the boot panel is the first
               place that claim appears. */
            subtitle={`${scenarios.length}${partial ? ` of ${poolSize}` : ""} scenario${scenarios.length === 1 ? "" : "s"} × ${repeats} repeat${repeats === 1 ? "" : "s"} · 4 at a time · agent ${runAgent} on a fresh sandbox copy of environment ${runEnv} for each${skipped.length ? ` · ${skipped.length} skipped, not proved` : ""}`}
            steps={BOOT_STEPS[surface.stage] || BOOT_STEPS.voice}
            onDone={start}
          />
        </Box>
      </Box>
    );
  }

  /* ── results ── */
  if (phase === "done") {
    return <RunResults env={env} runId={runId} tasks={tasks} stats={stats} evals={evals} stage={surface.stage} />;
  }

  /* ── live ── */
  const live = focus && ["running", "grading"].includes(focus.status);

  /* The run's number — the same one the Runs tab lists it under. */
  const ordinal = stored?.ordinal
    ?? Math.max(0, ...(envState.runs || []).map((r) => r.ordinal || 0)) + 1;

  /* Release blockers, counted as they settle. One failing is the thing worth
     knowing before the run ends. */
  const blockers = tasks.filter((t) => t.critical);
  const blockersPassed = blockers.filter((t) => t.status === "passed").length;
  const blockersFailed = blockers.filter((t) => t.status === "failed");

  /* Tools the agent calls that this world can't answer — the run was started
     anyway, and scenarios that reach for them come back not measured. */
  const toolGap = toolFit(env, envState, { agent: runAgent, envVersion: runEnv }).missing.map((t) => t.name);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* ── run header ── */}
      <Box sx={{ borderBottom: "1px solid", borderColor: "divider", flexShrink: 0 }}>
        <Stack direction="row" alignItems="center" spacing={2} sx={{ px: 3, py: 1.75 }}>
          <IconButton
            size="small"
            onClick={() => {
              /* Go back to the surface that opened this run — Improvements L2,
                 the env workspace's Runs tab, or wherever else. Falls back to
                 the env's Runs tab on cold-load (no history). */
              if (window.history.length > 1) navigate(-1);
              else navigate(paths.dashboard.simulate.environmentStep(envId, "runs"));
            }}
          >
            <Iconify icon="solar:alt-arrow-left-linear" width={18} sx={{ color: "text.subtitle" }} />
          </IconButton>

          <Box minWidth={0} flex={1}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography noWrap sx={{ typography: "s1_2", fontWeight: 700 }}>
                Run {ordinal}
              </Typography>
              <StatusChip status="running" />
              {partial && (
                <Chip label={`Re-run · ${scenarios.length} of ${poolSize} scenarios`} />
              )}
              {/* The isolation claim, where a viewer is most likely to doubt it. */}
              <Tooltip arrow title={SHADOW_SUMMARY}>
                <Box sx={{ display: "flex" }}>
                  <Chip icon="solar:shield-keyhole-linear" label="Sandbox" />
                </Box>
              </Tooltip>
            </Stack>
            <Typography noWrap sx={{ typography: "s2", color: "text.subtitle" }}>
              {env.name} · agent {runAgent} on environment {runEnv} · {stats.done} of {stats.total} scenarios done
              {repeats > 1 ? ` · ${repeats} repeats each` : ""} · {formatMs(elapsed)} elapsed
            </Typography>
            {/*
              Slow and stalled look identical on a progress bar, and telling
              them apart is the only question anyone has while waiting. So the
              heartbeat is stated: how long since anything moved, and a warning
              once that gap stops being normal.
            */}
            {phase === "running" && (
              <Stack direction="row" alignItems="center" spacing={0.625} sx={{ mt: 0.25 }}>
                <Box
                  sx={{
                    width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                    bgcolor: stalled ? RED : "#16A34A",
                    animation: stalled ? "none" : `${pulse} 1.6s ease-in-out infinite`,
                  }}
                />
                <Typography sx={{ typography: "s3", color: stalled ? RED : "text.subtitle" }}>
                  {stalled
                    ? `No heartbeat for ${sinceLastEvent}s — the run may be stalled`
                    : `Healthy · last event ${sinceLastEvent}s ago`}
                </Typography>
              </Stack>
            )}
          </Box>

          <LiveCounter label="Passed" value={stats.passed} color="#16A34A" />
          <LiveCounter label="Failed" value={stats.failed} color={RED} />
          <LiveCounter
            label="Flaky" value={stats.flaky} color={FLAKY}
            hint="Repeats disagreed — passed some, failed others."
          />
          <LiveCounter
            label="Not measured" value={stats.unmeasured} color={UNMEASURED}
            hint="Nothing could be scored — an environment or grading fault, not the agent's."
          />
          <LiveCounter label="Running" value={stats.active} color="#2563EB" />

          <Tooltip title="Stop run" arrow>
            <IconButton size="small" onClick={finishNow}>
              <Iconify icon="solar:stop-circle-linear" width={19} sx={{ color: RED }} />
            </IconButton>
          </Tooltip>
        </Stack>

        <LinearProgress
          variant="determinate"
          value={stats.progress}
          sx={{
            height: 3, bgcolor: "transparent",
            "& .MuiLinearProgress-bar": { bgcolor: "primary.main", transition: "transform .4s ease" },
          }}
        />
      </Box>

      {/* ── what to know about this run ── */}
      {(blockers.length > 0 || toolGap.length > 0 || skipped.length > 0) && (
        <Stack
          direction="row" alignItems="center" spacing={2.5} flexWrap="wrap" rowGap={0.75}
          sx={{ px: 3, py: 1, borderBottom: "1px solid", borderColor: "divider", flexShrink: 0 }}
        >
          {blockers.length > 0 && (
            <Tooltip
              arrow
              title={blockersFailed.length
                ? `Failed: ${blockersFailed.map((t) => t.name || t.title).join(", ")}. Any release blocker failing blocks the release.`
                : "Any release blocker failing blocks the release, however high the pass rate."}
            >
              <Stack direction="row" alignItems="center" spacing={0.625}>
                <Iconify icon="solar:danger-triangle-bold" width={13} sx={{ color: RED }} />
                <Typography sx={{ typography: "s3", color: "text.secondary" }}>
                  Release blockers · <b>{blockersPassed} of {blockers.length}</b> passed
                </Typography>
                {blockersFailed.length > 0 && (
                  <Typography sx={{ typography: "s3", fontWeight: 700, color: RED }}>
                    · {blockersFailed.length} failed
                  </Typography>
                )}
              </Stack>
            </Tooltip>
          )}
          {toolGap.length > 0 && (
            <Stack direction="row" alignItems="center" spacing={0.625}>
              <Iconify icon="solar:plug-circle-linear" width={14} sx={{ color: "#CA8A04" }} />
              <Typography sx={{ typography: "s3", color: "text.secondary" }}>
                Environment {runEnv} can&apos;t answer {toolGap.join(", ")} — scenarios that call {toolGap.length === 1 ? "it" : "them"} come back not measured.
              </Typography>
            </Stack>
          )}
          {skipped.length > 0 && (
            <Tooltip arrow title="Only proved scenarios are run. Re-prove these on the Scenarios tab to include them.">
              <Stack direction="row" alignItems="center" spacing={0.625}>
                <Iconify icon="solar:shield-cross-linear" width={14} sx={{ color: "text.subtitle" }} />
                <Typography sx={{ typography: "s3", color: "text.secondary" }}>
                  {skipped.length} skipped — not proved on environment {runEnv}
                </Typography>
              </Stack>
            </Tooltip>
          )}
        </Stack>
      )}

      {/* ── three columns ── */}
      <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* scenarios */}
        <Box sx={{ width: 300, flexShrink: 0, borderRight: "1px solid", borderColor: "divider", overflow: "auto", display: { xs: "none", md: "block" } }}>
          <ColumnLabel sticky>Scenarios ({stats.total})</ColumnLabel>
          <Stack divider={<Box sx={{ borderBottom: "1px solid", borderColor: "divider" }} />}>
            {tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                active={t.id === focusId}
                onClick={() => setFocusId(t.id)}
              />
            ))}
          </Stack>
          {skipped.length > 0 && (
            <>
              <ColumnLabel>Skipped · not proved ({skipped.length})</ColumnLabel>
              <Stack divider={<Box sx={{ borderBottom: "1px solid", borderColor: "divider" }} />}>
                {skipped.map((sc) => <SkippedRow key={sc.id} scenario={sc} />)}
              </Stack>
            </>
          )}
        </Box>

        {/* stage */}
        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {focus && (
            <>
              <Stack
                direction="row" alignItems="center" spacing={1.5}
                sx={{ px: 2.5, py: 1.5, borderBottom: "1px solid", borderColor: "divider", flexShrink: 0 }}
              >
                <StatusDot status={focus.status} />
                <Box minWidth={0} flex={1}>
                  <Typography noWrap sx={{ typography: "s2", fontWeight: 700 }}>{focus.name || focus.title}</Typography>
                  <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>{focus.task}</Typography>
                </Box>
                <Tooltip
                  arrow
                  title={repeats > 1
                    ? `The first repeat plays here turn by turn. The other ${repeats - 1} run alongside it and count toward the verdict.`
                    : ""}
                >
                  <Typography sx={{ typography: "s3", color: "text.subtitle", flexShrink: 0 }}>
                    {focus.stepIndex < 0 ? "Queued" : `Turn ${focus.stepIndex + 1} of ${focus.steps.length}`}
                    {repeats > 1 ? ` · repeat 1 of ${repeats}` : ""}
                  </Typography>
                </Tooltip>
              </Stack>
              <Stage
                stage={surface.stage}
                task={focus}
                stepIndex={focus.stepIndex}
                live={live}
                twinBacking={envState?.twinBacking}
                agentVersion={`Agent ${runAgent}`}
              />
            </>
          )}
        </Box>

        {/* live evals */}
        <Box sx={{ width: 288, flexShrink: 0, borderLeft: "1px solid", borderColor: "divider", overflow: "auto", display: { xs: "none", lg: "block" } }}>
          <LiveEvalPanel task={focus} evals={evals} env={env} />
        </Box>
      </Box>
    </Box>
  );
}

/* ── pieces ──────────────────────────────────────────────────────────────── */

function ColumnLabel({ children, sticky }) {
  return (
    <Typography
      sx={{
        px: 2, py: 1.25, typography: "s3", fontWeight: 700, color: "text.subtitle",
        textTransform: "uppercase", letterSpacing: 0.4,
        borderBottom: "1px solid", borderColor: "divider",
        ...(sticky
          ? { position: "sticky", top: 0, bgcolor: "background.default", zIndex: 1 }
          : { borderTop: "1px solid", borderTopColor: "divider" }),
      }}
    >
      {children}
    </Typography>
  );
}

function Chip({ icon, label }) {
  return (
    <Stack
      direction="row" alignItems="center" spacing={0.5}
      sx={{
        px: 0.75, height: 22, borderRadius: 0.75, color: "text.subtitle", flexShrink: 0,
        border: "1px solid", borderColor: "divider",
      }}
    >
      {icon && <Iconify icon={icon} width={12} />}
      <Typography noWrap sx={{ typography: "s3", fontWeight: 600 }}>{label}</Typography>
    </Stack>
  );
}

function LiveCounter({ label, value, color, hint }) {
  const counter = (
    <Stack alignItems="center" sx={{ px: 1, display: { xs: "none", sm: "flex" } }}>
      <Typography
        sx={{
          typography: "s1", fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: "tabular-nums",
          color: value ? color : "text.disabled",
        }}
      >
        {value}
      </Typography>
      <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>{label}</Typography>
    </Stack>
  );
  return hint ? <Tooltip arrow title={hint}>{counter}</Tooltip> : counter;
}

/* How a finished scenario came out, across its repeats. */
const resultText = (task) => {
  if (task.status === "unmeasured") return { text: "Not measured", color: UNMEASURED };
  if (!["passed", "failed", "flaky"].includes(task.status)) return null;
  const color = { passed: "#16A34A", failed: RED, flaky: FLAKY }[task.status];
  return { text: task.repeats > 1 ? `${task.passes}/${task.repeats}` : task.status === "passed" ? "Passed" : "Failed", color };
};

function TaskRow({ task, active, onClick }) {
  const progress = task.steps.length
    ? ((task.stepIndex + 1) / task.steps.length) * 100
    : 0;
  const result = resultText(task);
  return (
    <Box
      onClick={onClick}
      sx={{
        px: 2, py: 1.375, cursor: "pointer", position: "relative",
        bgcolor: active ? "action.hover" : "transparent",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      {active && (
        <Box sx={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, bgcolor: "primary.main" }} />
      )}
      <Stack direction="row" alignItems="center" spacing={1.25}>
        <StatusDot status={task.status} size={7} />
        <Box flex={1} minWidth={0}>
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Typography noWrap sx={{ typography: "s2", fontWeight: active ? 700 : 600 }}>
              {task.name || task.title}
            </Typography>
            <BlockerFlag row={task} reason={task.blockerReason} size={12} />
          </Stack>
          <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>
            {[task.summary, task.persona?.name].filter(Boolean).join(" · ")}
          </Typography>
        </Box>
        {result && (
          <Tooltip arrow title={task.repeats > 1 ? `Passed ${task.passes} of ${task.repeats} repeats` : ""}>
            <Typography sx={{ typography: "s3", fontWeight: 700, color: result.color, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
              {result.text}
            </Typography>
          </Tooltip>
        )}
      </Stack>

      {["running", "grading"].includes(task.status) && (
        <Box sx={{ mt: 0.875, height: 2, borderRadius: 1, bgcolor: "background.neutral", overflow: "hidden" }}>
          <Box
            sx={{
              height: "100%", width: `${progress}%`, bgcolor: "primary.main",
              transition: "width .4s ease",
            }}
          />
        </Box>
      )}
    </Box>
  );
}

function SkippedRow({ scenario }) {
  return (
    <Tooltip arrow placement="right" title={scenario.skipReason}>
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ px: 2, py: 1.25, opacity: 0.7 }}>
        <Iconify icon="solar:shield-cross-linear" width={12} sx={{ color: "text.disabled", flexShrink: 0 }} />
        <Box flex={1} minWidth={0}>
          <Typography noWrap sx={{ typography: "s2", fontWeight: 600, color: "text.secondary" }}>
            {scenario.name || scenario.title}
          </Typography>
          <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>Skipped — needs re-proving</Typography>
        </Box>
      </Stack>
    </Tooltip>
  );
}

/**
 * The right-hand column, in the order things happen.
 *
 * Sub-goals first: they move turn by turn, ticking on the line where the
 * agent actually did the thing. Evals next: they only score once the
 * conversation ends, one grader at a time. Then what a pass looks like, and
 * who is calling.
 */
function LiveEvalPanel({ task, evals, env }) {
  if (!task) return null;
  const grading = task.status === "grading";
  const settled = ["passed", "failed", "flaky", "unmeasured"].includes(task.status);
  const goals = subGoalStates(task, env);

  return (
    <Box>
      {goals.length > 0 && (
        <>
          <ColumnLabel>
            Sub-goals · {goals.filter((g) => g.state === "met").length} of {goals.length}
          </ColumnLabel>
          <Stack spacing={1.125} sx={{ px: 2, py: 1.5 }}>
            {goals.map((g) => <SubGoalRow key={g.id} goal={g} />)}
          </Stack>
        </>
      )}

      <ColumnLabel>Evals</ColumnLabel>
      {evals.length === 0 ? (
        <EmptyState
          icon="solar:shield-cross-linear"
          title="No evals applied"
          body="You'll get transcripts, but nothing scoring whether the agent was right."
        />
      ) : (
        <Stack divider={<Box sx={{ borderBottom: "1px solid", borderColor: "divider" }} />}>
          {task.evalResults.map((r, i) => {
            const resolved = (grading || settled) && i <= task.evalIndex;
            return (
              <Stack key={r.id} direction="row" alignItems="center" spacing={1.25} sx={{ px: 2, py: 1.375 }}>
                <Box
                  sx={{
                    width: 26, height: 26, borderRadius: 0.75, display: "grid", placeItems: "center", flexShrink: 0,
                    bgcolor: "background.neutral", color: "text.subtitle",
                  }}
                >
                  <Iconify icon={getEval(r.id)?.icon || "solar:shield-check-linear"} width={14} />
                </Box>
                <Typography noWrap sx={{ flex: 1, typography: "s2", fontWeight: 600 }}>{r.name}</Typography>
                {resolved ? (
                  <ScorePill score={r.score} passed={r.passed} label={r.reason} />
                ) : (
                  <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
                    {task.status === "queued" ? "—" : task.status === "running" ? "After the call" : "Scoring…"}
                  </Typography>
                )}
              </Stack>
            );
          })}
        </Stack>
      )}

      {/* What a pass looks like — the line the evals grade against. */}
      <ColumnLabel>Passes when</ColumnLabel>
      <Stack spacing={1.25} sx={{ p: 2 }}>
        <Typography sx={{ typography: "s2", color: "text.primary" }}>
          {(task.expected || "").replace(/\."\.$/, "\".")}
        </Typography>
        {task.critical && (
          <Stack direction="row" spacing={0.75} alignItems="flex-start">
            <Iconify icon="solar:danger-triangle-bold" width={13} sx={{ color: RED, flexShrink: 0, mt: "2px" }} />
            <Typography sx={{ typography: "s3", color: "text.secondary" }}>
              <b>Release blocker</b> · {shortReason(task.blockerReason)}
            </Typography>
          </Stack>
        )}
      </Stack>

      {/* Who is calling. The call header has the name; this has the rest. */}
      {task.persona && (
        <>
          <ColumnLabel>Caller</ColumnLabel>
          <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ p: 2 }}>
            <Box
              sx={{
                width: 28, height: 28, borderRadius: "50%", display: "grid", placeItems: "center", flexShrink: 0,
                bgcolor: (t) => alpha(t.palette.primary.main, 0.12), color: "primary.main",
                typography: "s3", fontWeight: 700,
              }}
            >
              {task.persona.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
            </Box>
            <Box minWidth={0}>
              <Typography sx={{ typography: "s2", fontWeight: 600 }}>
                {task.persona.name}
                <Box component="span" sx={{ color: "text.subtitle", fontWeight: 400 }}>
                  {task.persona.age ? ` · ${task.persona.age}` : task.persona.role ? ` · ${task.persona.role}` : ""}
                </Box>
              </Typography>
              {/* Wraps — a trait cut off mid-word is a trait nobody reads. */}
              <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
                {[...(task.persona.traits || []), task.persona.voice].filter(Boolean).join(" · ")}
              </Typography>
            </Box>
          </Stack>
        </>
      )}
    </Box>
  );
}

/* The blocker reason without the rule quoted again — "Passes when" just said it. */
const shortReason = (reason) => (reason || "any failure here blocks the release.")
  .replace(/:\s*“.*”\.?$/, ".")
  .replace(/^./, (c) => c.toLowerCase());

/*
  Where each sub-goal stands, read from the conversation itself.

  A script tags the turn that meets each milestone (verify, recognise, act,
  close), so a sub-goal ticks on that line. One whose wording isn't familiar is
  spread across the call instead. A failing run fails at its crux: what was
  due there, and everything after it, is missed.
*/
function subGoalStates(task, env) {
  const raw = task.subTasks?.length ? task.subTasks : subTasksFor(task, env);
  const n = raw.length;
  const last = task.steps.length - 1;
  const turnFor = (milestone, k) => {
    const at = milestone ? task.steps.findIndex((st) => st.meets?.includes(milestone)) : -1;
    return at >= 0 ? at : Math.floor(((k + 1) / n) * last);
  };
  const failAt = task.failStep;
  const reached = task.stepIndex;
  const done = ["passed", "failed", "flaky"].includes(task.status) || task.status === "grading";
  const rows = raw.map((g, k) => {
    const label = typeof g === "string" ? g : g.label;
    const turn = turnFor(milestoneOf(label, k, n), k);
    let state = "open";
    if (task.status === "unmeasured") state = "unscored";
    else if (failAt != null && turn >= failAt && (reached >= failAt || done)) state = "missed";
    else if (reached >= turn) state = "met";
    return { id: typeof g === "string" ? `${task.id}::${k}` : g.id, label, turn, state };
  });
  /* The one the conversation is working towards now. */
  if (task.status === "running") {
    const next = rows.filter((r) => r.state === "open").sort((a, b) => a.turn - b.turn)[0];
    if (next) next.state = "active";
  }
  return rows;
}

function SubGoalRow({ goal }) {
  const meta = {
    met: { icon: "solar:check-circle-bold", color: "#16A34A", note: `turn ${goal.turn + 1}` },
    missed: { icon: "solar:close-circle-bold", color: RED, note: "missed" },
    unscored: { note: "not measured" },
    active: { note: "in progress" },
    open: {},
  }[goal.state];
  return (
    <Stack direction="row" spacing={0.875} alignItems="flex-start">
      {meta.icon ? (
        <Iconify icon={meta.icon} width={14} sx={{ color: meta.color, flexShrink: 0, mt: "2px" }} />
      ) : (
        /* Not reached yet — a plain ring, drawn rather than fetched. The one
           being worked on now pulses in the accent. */
        <Box
          sx={{
            width: 12, height: 12, m: "3px 1px 0", borderRadius: "50%", flexShrink: 0,
            border: "1.5px solid",
            borderColor: goal.state === "active" ? "primary.main" : "text.disabled",
            ...(goal.state === "active" && { animation: `${pulse} 1.4s ease-in-out infinite` }),
          }}
        />
      )}
      <Typography
        sx={{
          flex: 1, minWidth: 0, typography: "s3",
          color: goal.state === "open" || goal.state === "unscored" ? "text.subtitle" : "text.secondary",
          fontWeight: goal.state === "active" ? 600 : 400,
        }}
      >
        {goal.label}
      </Typography>
      {meta.note && (
        <Typography
          sx={{
            typography: "s3", flexShrink: 0, whiteSpace: "nowrap",
            color: goal.state === "missed" ? RED : goal.state === "active" ? "primary.main" : "text.disabled",
          }}
        >
          {meta.note}
        </Typography>
      )}
    </Stack>
  );
}

function formatMs(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

ColumnLabel.propTypes = { children: PropTypes.node, sticky: PropTypes.bool };
Chip.propTypes = { icon: PropTypes.string, label: PropTypes.string };

LiveCounter.propTypes = {
  label: PropTypes.string,
  value: PropTypes.node,
  color: PropTypes.string,
  hint: PropTypes.string,
};

TaskRow.propTypes = {
  task: PropTypes.object,
  active: PropTypes.bool,
  onClick: PropTypes.func,
};

SkippedRow.propTypes = { scenario: PropTypes.object };
SubGoalRow.propTypes = { goal: PropTypes.object };

LiveEvalPanel.propTypes = {
  task: PropTypes.object,
  evals: PropTypes.array,
  env: PropTypes.object,
};
