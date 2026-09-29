"""Usage rows abandoned in ``processing`` are closed like a failed run.

Production (2026-09-28): 8 ``standalone_v2`` Protect rows in flight during the
18:08 UTC rollout stayed ``processing``; the usage views show them as running
forever. ``synthetic_dataset`` (908), ``simulate_tool_evaluation`` (4,494),
``run_prompt_gen`` and source-less resource rows are ``processing`` too, but
their code never closes them: those are finished, billed runs.
"""

import json
from datetime import timedelta
from decimal import Decimal

import pytest
from django.core.management import call_command
from django.utils import timezone

from ee.usage.models.usage import APICallLog, APICallType
from ee.usage.services.stale_usage import (
    close_stale_usage_row,
    recover_stale_usage_rows,
)
from model_hub.views.eval_runner import EvaluationRunner
from tfc.constants.api_calls import APICallStatusChoices, APICallTypeChoices
from tfc.utils.error_codes import get_error_message

pytestmark = [pytest.mark.requires_ee, pytest.mark.django_db]

PROCESSING = APICallStatusChoices.PROCESSING.value


def _row(organization, *, source, age, config=None, deducted_cost=0):
    row = APICallLog.no_workspace_objects.create(
        organization=organization,
        status=PROCESSING,
        cost=Decimal("0.5"),
        deducted_cost=Decimal(deducted_cost),
        source=source,
        config=json.dumps(config or {"mappings": {"input": "hi"}}),
    )
    # created_at is auto_now_add; age the row the way time would.
    APICallLog.no_workspace_objects.filter(id=row.id).update(
        created_at=timezone.now() - age
    )
    row.refresh_from_db()
    return row


def _config(row):
    row.refresh_from_db()
    return json.loads(row.config) if isinstance(row.config, str) else row.config


def test_abandoned_row_is_closed_with_the_interrupted_reason(organization):
    row = _row(organization, source="standalone_v2", age=timedelta(hours=30))

    recovered = recover_stale_usage_rows(apply=True, limit=100)

    assert [r.id for r in recovered] == [row.id]
    row.refresh_from_db()
    assert row.status == APICallStatusChoices.ERROR.value
    # Same shape and encoding the SDK path writes on failure.
    assert isinstance(row.config, str)
    assert _config(row) == {
        "mappings": {"input": "hi"},
        "output": {"output": None, "reason": get_error_message("RUN_INTERRUPTED")},
    }


def test_row_younger_than_its_source_age_is_live_and_untouched(organization):
    live = _row(organization, source="standalone_v2", age=timedelta(hours=23))

    assert recover_stale_usage_rows(apply=True, limit=100) == []

    live.refresh_from_db()
    assert live.status == PROCESSING


def test_older_than_cannot_shorten_a_source_age(organization):
    live = _row(organization, source="tracer", age=timedelta(hours=2))

    assert (
        recover_stale_usage_rows(apply=True, older_than=timedelta(hours=1), limit=100)
        == []
    )
    live.refresh_from_db()
    assert live.status == PROCESSING


@pytest.mark.parametrize(
    "source",
    ["synthetic_dataset", "simulate_tool_evaluation", "run_prompt_gen", None],
)
def test_rows_their_code_never_closes_are_finished_work(organization, source):
    finished = _row(organization, source=source, age=timedelta(days=5))

    assert recover_stale_usage_rows(apply=True, limit=100) == []

    finished.refresh_from_db()
    assert finished.status == PROCESSING


def test_dry_run_changes_nothing(organization):
    row = _row(organization, source="eval_playground", age=timedelta(days=2))

    listed = recover_stale_usage_rows(apply=False, limit=100)

    assert [r.id for r in listed] == [row.id]
    row.refresh_from_db()
    assert row.status == PROCESSING
    assert "output" not in _config(row)


def test_row_closed_meanwhile_keeps_its_outcome(organization):
    row = _row(organization, source="standalone_v2", age=timedelta(hours=30))
    APICallLog.no_workspace_objects.filter(id=row.id).update(
        status=APICallStatusChoices.SUCCESS.value
    )

    assert close_stale_usage_row(row, now=timezone.now()) is None

    row.refresh_from_db()
    assert row.status == APICallStatusChoices.SUCCESS.value


def _refunds(row):
    return APICallLog.no_workspace_objects.filter(refund_parent_id=str(row.id))


@pytest.mark.parametrize("deducted_cost", [0, "0.5"])
def test_billing_matches_the_eval_runner_error_path(organization, deducted_cost):
    """No charge was taken for a postpaid row, so nothing is refunded; a legacy
    wallet row gets back exactly what the runner's own error path returns."""
    APICallType.objects.get_or_create(name=APICallTypeChoices.WALLET_REFUND.value)
    abandoned = _row(
        organization,
        source="dataset_evaluation",
        age=timedelta(hours=30),
        deducted_cost=deducted_cost,
    )
    failed = _row(
        organization,
        source="dataset_evaluation",
        age=timedelta(minutes=1),
        deducted_cost=deducted_cost,
    )
    runner = EvaluationRunner.__new__(EvaluationRunner)
    runner.user_eval_metric_id = "metric"
    runner._handle_api_call_status(failed, "error")

    recover_stale_usage_rows(apply=True, sources=["dataset_evaluation"], limit=100)
    recover_stale_usage_rows(apply=True, sources=["dataset_evaluation"], limit=100)

    abandoned.refresh_from_db()
    assert abandoned.status == failed.status == APICallStatusChoices.ERROR.value
    assert [r.cost for r in _refunds(abandoned)] == [r.cost for r in _refunds(failed)]
    assert _refunds(abandoned).count() == (1 if Decimal(deducted_cost) else 0)


def test_sources_that_never_refund_on_error_are_not_refunded(organization):
    """The SDK path closes a failed row without a refund, so recovery does too,
    even for a legacy row that took a wallet deduction."""
    APICallType.objects.get_or_create(name=APICallTypeChoices.WALLET_REFUND.value)
    legacy = _row(
        organization,
        source="standalone_v2",
        age=timedelta(days=90),
        deducted_cost="0.5",
    )

    (listed,) = recover_stale_usage_rows(apply=False, limit=100)
    (closed,) = recover_stale_usage_rows(apply=True, limit=100)

    assert listed.refunded is closed.refunded is False
    assert not _refunds(legacy).exists()


def test_command_dry_run_changes_nothing_then_apply_closes(organization, capsys):
    row = _row(organization, source="standalone_v2", age=timedelta(hours=30))

    call_command("recover_stale_work", "--source", "standalone_v2")

    out = capsys.readouterr().out
    assert "dry run, nothing written" in out
    assert f"standalone_v2 {organization.id}: 1, 1" in out
    row.refresh_from_db()
    assert row.status == PROCESSING

    call_command("recover_stale_work", "--source", "standalone_v2", "--apply")

    assert "Stale work (applied): 1 recovered" in capsys.readouterr().out
    row.refresh_from_db()
    assert row.status == APICallStatusChoices.ERROR.value
