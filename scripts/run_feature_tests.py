"""Feature test runner.

Drives the debate and group-discussion features end to end against the real
state machines and the real scoring pipeline, using a fixed corpus of
transcripts that spans content types (strong / vague / too-short / off-topic /
filler). Prints a score table plus pass-fail checks.

Usage (from the repo root, with the venv active):

    python scripts/run_feature_tests.py                 # everything
    python scripts/run_feature_tests.py --only debate   # one area
    python scripts/run_feature_tests.py --runs 3        # average the LLM judge
    python scripts/run_feature_tests.py --strict        # LLM expectations must hold
    python scripts/run_feature_tests.py --no-llm        # skip LLM-dependent areas

Scope: covers scoring and state transitions. Transcripts are injected, so
Whisper/ASR accuracy is not exercised. Writes go to a temp directory, so
outputs/*.jsonl is left untouched.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

# Make the repo root importable when run as `python scripts/run_feature_tests.py`.
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

AREAS = ("api", "scoring", "debate", "gd")


def _load_dotenv() -> None:
    """Export .env into the process environment.

    Needed because ``LLMClient`` reads ``GROQ_API_KEY`` with ``os.getenv``,
    while pydantic-settings only parses .env for ``Settings``. Without this,
    a local run silently falls back to Ollama and every LLM call fails.
    Existing environment variables win, so CI/systemd values are respected.
    """
    env_file = REPO_ROOT / ".env"
    if not env_file.is_file():
        return
    try:
        from dotenv import load_dotenv

        load_dotenv(env_file, override=False)
        return
    except Exception:  # noqa: BLE001 - fall back to a minimal parser
        pass

    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run end-to-end feature tests for debate, GD and scoring."
    )
    parser.add_argument(
        "--only",
        choices=AREAS,
        action="append",
        help="Run only the given area (repeatable). Default: all.",
    )
    parser.add_argument(
        "--runs",
        type=int,
        default=1,
        help="How many times to score each sample in the content matrix (default 1).",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Treat LLM-judgement expectations as hard failures instead of warnings.",
    )
    parser.add_argument(
        "--no-llm",
        action="store_true",
        help="Skip areas that call the LLM (content matrix, debate, GD scoring).",
    )
    parser.add_argument(
        "--pace",
        type=float,
        default=5.0,
        help=(
            "Seconds to wait between LLM calls (default 5.0). Groq's free tier "
            "caps tokens-per-minute, and these prompts are large."
        ),
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Show application log output (noisy).",
    )
    return parser.parse_args()


async def _main() -> int:
    args = _parse_args()
    areas = tuple(args.only) if args.only else AREAS

    # LLM feedback quotes student text and emoji; the default Windows console
    # codec (cp1252) cannot encode it and would abort the report.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.ERROR,
        format="%(levelname)s | %(name)s | %(message)s",
    )

    _load_dotenv()

    if args.no_llm:
        # Both providers unset -> llm.is_available is False and the scoring
        # paths take their documented "unavailable" branch.
        os.environ.pop("GROQ_API_KEY", None)
        os.environ["OLLAMA_URL"] = ""

    from app.utils.file_utils import ensure_directories

    from feature_tests import api_smoke, debate_flow, gd_flow, scoring_matrix
    from feature_tests.harness import Report, sandboxed_stores
    from feature_tests.synth import cleanup_artifacts

    ensure_directories()
    report = Report()

    if args.no_llm:
        from app.core import llm_client
        from app.core.config import settings

        settings.GROQ_API_KEY = None
        llm_client.llm.groq_key = None
        llm_client.llm.ollama_url = ""

    print("Running feature tests. LLM scoring makes this take a minute or two.")

    pace = 0.0 if args.no_llm else max(0.0, args.pace)

    try:
        with sandboxed_stores() as sandbox:
            if "api" in areas:
                api_smoke.run(report)
            if "scoring" in areas:
                await scoring_matrix.run(
                    report, runs=args.runs, strict=args.strict, pace=pace
                )
            if "debate" in areas:
                await debate_flow.run(report, sandbox, strict=args.strict, pace=pace)
            if "gd" in areas:
                await gd_flow.run(report, sandbox, strict=args.strict, pace=pace)
    finally:
        removed = cleanup_artifacts()

    print(report.render())
    if removed:
        print(f"Cleaned up {removed} stub audio file(s) from uploads/.")
    return 1 if report.failed else 0


def main() -> int:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    try:
        return asyncio.run(_main())
    except KeyboardInterrupt:
        print("\ninterrupted")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
