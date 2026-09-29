"""Close eval cells and usage rows abandoned mid-run.

The same recovery the hourly ``recover-stale-work`` schedule runs, for closing
an existing backlog by hand. Dry run by default: it lists what would be closed,
per source, organization and dataset, and writes nothing.

A hosted deployment runs it as a one-shot operator job
(SERVICE_TYPE=bootstrap, STARTUP_DB_MUTATION_MODE=operator), like the other
data commands allowlisted in model_hub/apps.py.

Usage:
    python manage.py recover_stale_work                          # dry run
    python manage.py recover_stale_work --apply
    python manage.py recover_stale_work --source standalone_v2 --source tracer
    python manage.py recover_stale_work --older-than 72 --batch-size 200
"""

from collections import Counter
from datetime import timedelta

from django.core.management.base import BaseCommand

from model_hub.services.stale_work import (
    DATASET_EVAL_SOURCE,
    RecoveredWork,
    recover_stale_work,
    recoverable_sources,
)


class Command(BaseCommand):
    help = "Close eval cells and usage rows abandoned mid-run (dry run unless --apply)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply", action="store_true", help="Write; without it nothing changes."
        )
        parser.add_argument(
            "--older-than",
            type=float,
            default=None,
            metavar="HOURS",
            help="Only work older than this. Never below a source's own minimum age.",
        )
        parser.add_argument(
            "--source",
            action="append",
            dest="sources",
            choices=recoverable_sources(),
            help="Repeat to pick several; default every source.",
        )
        parser.add_argument("--batch-size", type=int, default=500)

    def handle(self, *args, **opts):
        older_than = timedelta(hours=opts["older_than"]) if opts["older_than"] else None
        recovered: list[RecoveredWork] = []
        skipped: dict[str, str] = {}
        while True:
            report = recover_stale_work(
                apply=opts["apply"],
                batch_size=opts["batch_size"],
                sources=opts["sources"],
                older_than=older_than,
            )
            recovered.extend(report.recovered)
            skipped.update(report.skipped)
            # A dry run changes nothing, so another pass would list the same.
            if not opts["apply"] or not report.recovered:
                break

        mode = "applied" if opts["apply"] else "dry run, nothing written"
        self.stdout.write(f"Stale work ({mode}): {len(recovered)} recovered")
        # Only legacy wallet rows of sources whose error path refunds.
        refunds = sum(work.refunds for work in recovered)
        self.stdout.write(f"  wallet refunds: {refunds}")
        for source, reason in sorted(skipped.items()):
            self.stdout.write(f"  skipped {source}: {reason}")
        evals = sum(work.source == DATASET_EVAL_SOURCE for work in recovered)
        if not opts["apply"] and opts["batch_size"] in (evals, len(recovered) - evals):
            self.stdout.write(
                f"  listing stopped at --batch-size {opts['batch_size']}; "
                "raise it to list everything"
            )
        self._write_counts("source", recovered, lambda w: (w.source,))
        self._write_counts(
            "source, organization", recovered, lambda w: (w.source, w.organization_id)
        )
        self._write_counts(
            "dataset, organization",
            [w for w in recovered if w.dataset_id],
            lambda w: (w.dataset_id, w.organization_id),
        )

    def _write_counts(self, title, recovered, key):
        units = Counter(key(work) for work in recovered)
        items = Counter()
        for work in recovered:
            items[key(work)] += work.items
        self.stdout.write(f"By {title} (units, items):")
        for group, count in units.most_common():
            self.stdout.write(f"  {' '.join(group)}: {count}, {items[group]}")
