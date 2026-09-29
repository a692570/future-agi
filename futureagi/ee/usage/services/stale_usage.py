"""Close usage rows whose run was abandoned in ``processing``.

The eval paths below create their usage row ``processing`` before the work and
write ``success`` or ``error`` after it. A worker that dies in between (a
deploy restart, an OOM, a killed activity) leaves the row ``processing`` for
good, and the usage views show the run as still going.

Other sources write ``processing`` rows that are finished work:
``synthetic_dataset``, ``simulate_tool_evaluation``, the prompt runs logged
under ``run_prompt_gen`` and the resource checks (no source) create the row
after the work and never close it. They are billed through the usage event
emitted beside the row, so recovering them would report finished work as
failed. They are left alone.
"""

from __future__ import annotations

import json
from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime, timedelta

import structlog
from django.db.models import Q
from django.utils import timezone

from ee.usage.models.usage import APICallLog
from ee.usage.utils.usage_entries import refund_cost_for_api_call
from tfc.constants.api_calls import APICallStatusChoices
from tfc.utils.error_codes import get_error_message

logger = structlog.get_logger(__name__)

# Each source's row lives no longer than the work that creates and closes it;
# the age is past that ceiling, so a row this old has no run left to close it.
STALE_AFTER_BY_SOURCE: dict[str, timedelta] = {
    # SDK and Protect evals: a request, or RunEvaluationWorkflow's 12 h activity.
    "standalone_v2": timedelta(hours=24),
    # run_eval_func: a request, or run_eval_func_task's 1 h activity.
    "eval_playground": timedelta(hours=24),
    # run_eval_func inside simulation activities (at most 3 h).
    "simulate": timedelta(hours=24),
    # Observe evals: the 30 min run_entry activity; legacy paths the 12 h
    # drop-in activity ceiling.
    "tracer": timedelta(hours=24),
    "tracer_composite": timedelta(hours=24),
    # One row per evaluated cell, inside the 1 h dataset eval activity or a
    # 12 h experiment activity.
    "dataset_evaluation": timedelta(hours=24),
    "experiment": timedelta(hours=24),
}


# Sources whose error path hands a wallet deduction back
# (EvaluationRunner._handle_api_call_status). The SDK, run_eval_func and Observe
# error paths close the row without a refund.
_REFUNDED_ON_ERROR = frozenset({"dataset_evaluation", "experiment"})


@dataclass(frozen=True)
class RecoveredUsageRow:
    id: int
    source: str
    organization_id: str
    created_at: datetime
    refunded: bool


def _stale_after(source: str, older_than: timedelta | None) -> timedelta:
    # An operator may wait longer than the source's ceiling, never less.
    floor = STALE_AFTER_BY_SOURCE[source]
    return max(floor, older_than) if older_than else floor


def find_stale_usage_rows(
    *,
    sources: Collection[str],
    older_than: timedelta | None,
    limit: int,
    now: datetime,
) -> list[APICallLog]:
    """Oldest-first ``processing`` rows past their source's age.

    ``created_at`` is the start of the run: nothing writes the row between its
    creation and the outcome.
    """
    if not sources:
        # An empty Q() matches every processing row, finished work included.
        return []
    stale = Q()
    for source in sources:
        stale |= Q(source=source, created_at__lt=now - _stale_after(source, older_than))
    return list(
        APICallLog.no_workspace_objects.filter(
            stale, status=APICallStatusChoices.PROCESSING.value
        ).order_by("created_at")[:limit]
    )


def _with_interrupted_output(config: dict | str, reason: str) -> dict | str:
    """The row's config with the error output the eval paths write.

    Most rows hold their config as a JSON string inside the JSON field; keep
    whichever encoding the row has.
    """
    output = {"output": None, "reason": reason}
    if isinstance(config, str):
        decoded = json.loads(config) if config else {}
        decoded["output"] = output
        return json.dumps(decoded, default=str)
    return {**config, "output": output}


def _owes_refund(row: APICallLog) -> bool:
    """Whether the source's own error path would refund this row now.

    Postpaid rows deduct nothing, so only legacy wallet rows qualify, and a row
    already refunded is not refunded again.
    """
    return (
        row.source in _REFUNDED_ON_ERROR
        and row.deducted_cost > 0
        and not APICallLog.no_workspace_objects.filter(
            refund_parent_id=str(row.id)
        ).exists()
    )


def _recovered(row: APICallLog, *, refunded: bool) -> RecoveredUsageRow:
    return RecoveredUsageRow(
        id=row.id,
        source=row.source,
        organization_id=str(row.organization_id),
        created_at=row.created_at,
        refunded=refunded,
    )


def close_stale_usage_row(
    row: APICallLog, *, now: datetime
) -> RecoveredUsageRow | None:
    """Close ``row`` the way its source closes a failed run.

    Every eval path sets ``error`` with the reason in ``config.output`` and
    bills nothing: usage is billed by the event emitted on success, and a
    failed run emits none. The dataset and experiment path also calls
    ``refund_cost_for_api_call``, which records the return of a wallet
    deduction; recovery does the same for those sources and no others.

    The write is guarded on ``processing``: a run that closes the row in the
    meantime keeps its outcome, and the row is not reported.
    """
    reason = get_error_message("RUN_INTERRUPTED")
    closed = APICallLog.no_workspace_objects.filter(
        id=row.id, status=APICallStatusChoices.PROCESSING.value
    ).update(
        status=APICallStatusChoices.ERROR.value,
        config=_with_interrupted_output(row.config, reason),
        updated_at=now,
    )
    if not closed:
        return None
    refunded = (
        _owes_refund(row)
        and refund_cost_for_api_call(row, config={"reason": reason}) is not None
    )
    return _recovered(row, refunded=refunded)


def recover_stale_usage_rows(
    *,
    apply: bool,
    sources: Collection[str] | None = None,
    older_than: timedelta | None = None,
    limit: int,
) -> list[RecoveredUsageRow]:
    """Close (or, without ``apply``, list) up to ``limit`` abandoned rows."""
    now = timezone.now()
    rows = find_stale_usage_rows(
        sources=STALE_AFTER_BY_SOURCE.keys() if sources is None else sources,
        older_than=older_than,
        limit=limit,
        now=now,
    )
    if not apply:
        # ``refunded`` then says what an apply would refund.
        return [_recovered(row, refunded=_owes_refund(row)) for row in rows]
    recovered = []
    for row in rows:
        try:
            closed = close_stale_usage_row(row, now=now)
        except Exception:
            # One unreadable row must not keep the rest open; the next tick
            # retries it.
            logger.exception("stale_usage_row_close_failed", usage_row_id=row.id)
            continue
        if closed:
            recovered.append(closed)
    logger.info("stale_usage_rows_closed", candidates=len(rows), closed=len(recovered))
    return recovered
