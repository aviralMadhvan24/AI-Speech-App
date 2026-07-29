"""Result collection, reporting and storage sandboxing for feature tests."""

from __future__ import annotations

import contextlib
import importlib
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

PASS = "PASS"
FAIL = "FAIL"
WARN = "WARN"
SKIP = "SKIP"

_ICON = {PASS: "[ok]  ", FAIL: "[FAIL]", WARN: "[warn]", SKIP: "[skip]"}

# Storage modules whose module-level `_PATH` is redirected while tests run,
# so a test run never appends to the real outputs/*.jsonl data files.
_STORE_MODULES = (
    "app.storage.debates",
    "app.storage.debate_turns",
    "app.storage.gd_sessions",
    "app.storage.gd_speeches",
    "app.storage.users",
)


@dataclass
class Check:
    name: str
    status: str
    detail: str = ""


@dataclass
class Section:
    """One feature area's checks plus any free-form observed data."""

    title: str
    checks: list[Check] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    error: str | None = None

    def record(
        self,
        name: str,
        ok: bool,
        detail: str = "",
        *,
        soft: bool = False,
        strict: bool = False,
    ) -> bool:
        """Record a check.

        ``soft`` checks report WARN instead of FAIL when they do not hold.
        They cover LLM-judgement expectations, which are inherently
        non-deterministic. Passing ``strict=True`` promotes them to hard
        failures.
        """
        if ok:
            status = PASS
        elif soft and not strict:
            status = WARN
        else:
            status = FAIL
        self.checks.append(Check(name, status, detail))
        return ok

    def skip(self, name: str, reason: str) -> None:
        self.checks.append(Check(name, SKIP, reason))

    def note(self, line: str) -> None:
        self.notes.append(line)

    @property
    def failed(self) -> int:
        return sum(1 for c in self.checks if c.status == FAIL)

    @property
    def warned(self) -> int:
        return sum(1 for c in self.checks if c.status == WARN)

    @property
    def passed(self) -> int:
        return sum(1 for c in self.checks if c.status == PASS)


class Report:
    """Collects sections and renders a plain-text report."""

    def __init__(self) -> None:
        self.sections: list[Section] = []

    def section(self, title: str) -> Section:
        section = Section(title)
        self.sections.append(section)
        return section

    @property
    def failed(self) -> int:
        return sum(s.failed for s in self.sections)

    @property
    def warned(self) -> int:
        return sum(s.warned for s in self.sections)

    @property
    def passed(self) -> int:
        return sum(s.passed for s in self.sections)

    def render(self) -> str:
        lines: list[str] = []
        for section in self.sections:
            lines.append("")
            lines.append("=" * 78)
            lines.append(section.title)
            lines.append("=" * 78)
            if section.error:
                lines.append(f"{_ICON[FAIL]} section aborted: {section.error}")
            for note in section.notes:
                lines.append(f"       {note}")
            if section.notes and section.checks:
                lines.append("")
            for check in section.checks:
                line = f"{_ICON[check.status]} {check.name}"
                if check.detail:
                    line += f" -- {check.detail}"
                lines.append(line)

        lines.append("")
        lines.append("=" * 78)
        lines.append(
            f"SUMMARY  passed={self.passed}  warnings={self.warned}  failed={self.failed}"
        )
        lines.append("=" * 78)
        if self.warned:
            lines.append(
                "Warnings are LLM-judgement expectations that did not hold this run. "
                "Re-run with --strict to treat them as failures."
            )
        return "\n".join(lines)


@contextlib.contextmanager
def sandboxed_stores() -> Iterator[Path]:
    """Redirect all JSONL stores to a throwaway directory for the run."""
    tmp = Path(tempfile.mkdtemp(prefix="softskills-feature-test-"))
    originals: dict[str, Path] = {}
    try:
        for name in _STORE_MODULES:
            module = importlib.import_module(name)
            originals[name] = module._PATH
            module._PATH = tmp / Path(module._PATH).name
        yield tmp
    finally:
        for name, original in originals.items():
            importlib.import_module(name)._PATH = original
        shutil.rmtree(tmp, ignore_errors=True)


def count_jsonl(path: Path) -> int:
    """Number of non-blank lines in a JSONL file (0 when missing)."""
    if not path.is_file():
        return 0
    with path.open("r", encoding="utf-8") as handle:
        return sum(1 for line in handle if line.strip())


async def score_with_retry(scorer, *args, attempts: int = 3, pace: float = 5.0, **kwargs):
    """Call an LLM scorer, retrying when the provider rate-limits us.

    ``score_debate_content`` swallows transport errors and returns an
    unavailable result, so a 429 is indistinguishable from a genuine parse
    failure at this level. Retrying with a longer wait resolves the former and
    costs one extra call for the latter.
    """
    import asyncio

    result = None
    for attempt in range(attempts):
        result = await scorer(*args, **kwargs)
        if getattr(result, "available", False):
            return result
        error = (getattr(result, "error", "") or "").lower()
        retryable = "parse" in error or "scoring error" in error
        if not retryable or attempt == attempts - 1:
            return result
        await asyncio.sleep(max(pace, 5.0) * (attempt + 2))
    return result


def bar(value: float, maximum: float, width: int = 18) -> str:
    """Small ASCII meter used in the score tables."""
    if maximum <= 0:
        return " " * width
    filled = int(round(max(0.0, min(1.0, value / maximum)) * width))
    return "#" * filled + "." * (width - filled)
