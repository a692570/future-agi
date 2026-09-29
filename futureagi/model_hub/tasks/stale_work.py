"""Scheduled recovery of work abandoned mid-run (``recover-stale-work``)."""

from collections import Counter

import structlog

from model_hub.services.stale_work import recover_stale_work
from tfc.temporal.drop_in import temporal_activity

logger = structlog.get_logger(__name__)

# Per kind and tick; an hourly tick sees at most the work one deploy abandoned.
STALE_WORK_BATCH_SIZE = 500


@temporal_activity(time_limit=900, max_retries=0, queue="default")
def recover_stale_work_activity() -> dict:
    report = recover_stale_work(apply=True, batch_size=STALE_WORK_BATCH_SIZE)
    recovered = dict(Counter(work.source for work in report.recovered))
    logger.info("stale_work_recovered", recovered=recovered, skipped=report.skipped)
    return {"recovered": recovered, "skipped": report.skipped}
