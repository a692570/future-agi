"""Recovery for work abandoned mid-run, by source.

The ``recover-stale-work`` schedule and the ``recover_stale_work`` command both
come through ``recover_stale_work``. Dataset eval cells are recovered here;
usage rows live in the enterprise usage ledger and are recovered there.
"""

from __future__ import annotations

from collections.abc import Callable, Collection, Sequence
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

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


@dataclass(frozen=True)
class _UsageLedger:
    sources: frozenset[str]
    recover: Callable[..., Sequence[Any]]


def _usage_ledger() -> _UsageLedger | None:
    # The usage ledger (APICallLog) exists only with the enterprise tree; the
    # open build keeps no usage rows, so there is nothing to recover there.
    try:
        from ee.usage.services.stale_usage import (
            STALE_AFTER_BY_SOURCE,
            recover_stale_usage_rows,
        )
    except ImportError:
        return None
    return _UsageLedger(
        sources=frozenset(STALE_AFTER_BY_SOURCE), recover=recover_stale_usage_rows
    )


def recoverable_sources() -> list[str]:
    ledger = _usage_ledger()
    return [DATASET_EVAL_SOURCE, *sorted(ledger.sources if ledger else ())]


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

    usage_sources = selected - {DATASET_EVAL_SOURCE}
    ledger = _usage_ledger() if usage_sources else None
    if ledger:
        try:
            rows = ledger.recover(
                apply=apply,
                sources=usage_sources,
                older_than=older_than,
                limit=batch_size,
            )
        except Exception:
            logger.exception("stale_usage_row_recovery_failed")
            report.skipped.update(dict.fromkeys(usage_sources, "error"))
        else:
            report.recovered.extend(
                RecoveredWork(
                    source=row.source,
                    organization_id=row.organization_id,
                    dataset_id=None,
                    items=1,
                    refunds=int(row.refunded),
                )
                for row in rows
            )
    return report
