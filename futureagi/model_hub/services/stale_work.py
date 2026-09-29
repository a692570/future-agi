"""Recovery for work abandoned mid-run, by source.

The ``recover-stale-work`` schedule and the ``recover_stale_work`` command both
come through ``recover_stale_work``. Dataset eval cells are recovered here.
Other in-progress state is recovered by the app that owns it, which registers
a recoverer for its sources when it loads (the enterprise usage app does, for
its usage rows); the open build registers none.
"""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Protocol

import structlog

from model_hub.services.stale_eval_recovery import recover_stale_dataset_evals

logger = structlog.get_logger(__name__)

DATASET_EVAL_SOURCE = "dataset_eval_cells"


@dataclass(frozen=True)
class RecoveredWork:
    """One recovered unit: a dataset eval (``items`` cells) or a usage row."""

    source: str
    organization_id: str
    dataset_id: str | None
    items: int
    # Wallet refunds recorded (or, in a dry run, due) for this unit.
    refunds: int = 0


@dataclass(frozen=True)
class StaleWorkReport:
    recovered: list[RecoveredWork] = field(default_factory=list)
    # Source -> why it was not read ("mirror_idle", "error", ...).
    skipped: dict[str, str] = field(default_factory=dict)


class StaleWorkRecoverer(Protocol):
    def __call__(
        self,
        *,
        apply: bool,
        sources: Collection[str],
        older_than: timedelta | None,
        limit: int,
    ) -> Sequence[RecoveredWork]:
        """Close (or, without ``apply``, list) up to ``limit`` abandoned units
        of ``sources``, never younger than the source's own minimum age."""


# Source -> the recoverer its owning app registered.
_RECOVERERS: dict[str, StaleWorkRecoverer] = {}


def register_stale_work_recoverer(
    sources: Collection[str], recover: StaleWorkRecoverer
) -> None:
    """Recover ``sources`` with ``recover``; registering again replaces it."""
    for source in sources:
        _RECOVERERS[source] = recover


def recoverable_sources() -> list[str]:
    return [DATASET_EVAL_SOURCE, *sorted(_RECOVERERS)]


def recover_stale_work(
    *,
    apply: bool,
    batch_size: int,
    sources: Collection[str] | None = None,
    older_than: timedelta | None = None,
) -> StaleWorkReport:
    """Close (or, without ``apply``, list) up to ``batch_size`` items per kind.

    ``older_than`` can only lengthen a source's age, never shorten it below the
    longest run that source can have. One kind failing does not stop the other;
    the failure is logged and reported as skipped.
    """
    known = recoverable_sources()
    selected = set(sources) if sources else set(known)
    unknown = selected - set(known)
    if unknown:
        raise ValueError(f"Unknown sources: {sorted(unknown)}; known: {known}")

    report = StaleWorkReport()
    if DATASET_EVAL_SOURCE in selected:
        try:
            evals = recover_stale_dataset_evals(
                apply=apply, older_than=older_than, limit=batch_size
            )
        except Exception:
            logger.exception("stale_dataset_eval_recovery_failed")
            report.skipped[DATASET_EVAL_SOURCE] = "error"
        else:
            if evals.skipped:
                report.skipped[DATASET_EVAL_SOURCE] = evals.skipped
            report.recovered.extend(
                RecoveredWork(
                    source=DATASET_EVAL_SOURCE,
                    organization_id=recovered.organization_id,
                    dataset_id=recovered.dataset_id,
                    items=recovered.running_cells,
                )
                for recovered in evals.recovered
            )

    sources_by_recoverer: dict[StaleWorkRecoverer, set[str]] = {}
    for source in selected - {DATASET_EVAL_SOURCE}:
        sources_by_recoverer.setdefault(_RECOVERERS[source], set()).add(source)
    for recover, recover_sources in sources_by_recoverer.items():
        try:
            report.recovered.extend(
                recover(
                    apply=apply,
                    sources=recover_sources,
                    older_than=older_than,
                    limit=batch_size,
                )
            )
        except Exception:
            logger.exception(
                "stale_work_recovery_failed", sources=sorted(recover_sources)
            )
            report.skipped.update(dict.fromkeys(recover_sources, "error"))
    return report
