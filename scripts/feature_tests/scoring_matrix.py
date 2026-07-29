"""Direct content-scoring matrix across content types.

Calls ``score_debate_content`` on each corpus sample so the LLM rubric can be
inspected in isolation from the room state machine. With ``--runs N`` each
sample is scored N times and averaged, which is the honest way to look at a
stochastic judge.
"""

from __future__ import annotations

import asyncio
from statistics import mean

from app.core.llm_client import llm
from app.debate.content_scoring import score_debate_content

from .corpus import DEBATE_MOTION, DEBATE_SAMPLES
from .harness import Report, bar, score_with_retry


async def run(
    report: Report, *, runs: int = 1, strict: bool = False, pace: float = 5.0
) -> None:
    section = report.section(
        f"CONTENT SCORING MATRIX - {len(DEBATE_SAMPLES)} content types x {runs} run(s)"
    )

    if not llm.is_available:
        section.skip("content scoring", "no LLM provider configured (set GROQ_API_KEY)")
        return

    section.note(f"provider: {llm.provider}")
    section.note(f"motion: {DEBATE_MOTION.title}")

    totals: dict[str, float] = {}
    try:
        section.note("")
        section.note(
            "sample        words  relevance/15  arguments/15  structure/10  vocab/10   total/50"
        )
        first_call = True
        for sample in DEBATE_SAMPLES:
            observations = []
            for _ in range(runs):
                if not first_call and pace:
                    await asyncio.sleep(pace)
                first_call = False
                result = await score_with_retry(
                    score_debate_content,
                    transcript=sample.text,
                    motion_title=DEBATE_MOTION.title,
                    motion_text=DEBATE_MOTION.text,
                    pace=pace,
                )
                observations.append(result)

            usable = [r for r in observations if r.available]
            if not usable:
                section.record(
                    f"{sample.key}: scoring returned a result",
                    False,
                    observations[0].error or "unavailable",
                )
                continue

            avg_total = mean(r.total for r in usable)
            totals[sample.key] = avg_total
            section.note(
                f"  {sample.key:<12} {sample.word_count:>4}  "
                f"{mean(r.relevance for r in usable):>10.1f}  "
                f"{mean(r.arguments for r in usable):>11.1f}  "
                f"{mean(r.structure for r in usable):>11.1f}  "
                f"{mean(r.vocabulary for r in usable):>8.1f}  "
                f"{avg_total:>8.1f} {bar(avg_total, 50)}"
            )

            section.record(
                f"{sample.key}: total equals the sum of its parts",
                all(
                    r.total == r.relevance + r.arguments + r.structure + r.vocabulary
                    for r in usable
                ),
                f"avg total={avg_total:.1f}",
            )
            section.record(
                f"{sample.key}: feedback returned",
                all(r.feedback.strip() for r in usable),
                usable[0].feedback[:80],
            )

        # --- guard rails on the rubric itself ------------------------------
        if "off_topic" in totals:
            section.record(
                "off-topic content is pushed to the bottom of the scale",
                totals["off_topic"] <= 20,
                f"off_topic avg total={totals['off_topic']:.1f}/50",
                soft=True,
                strict=strict,
            )
        if {"strong", "moderate"} <= totals.keys():
            section.record(
                "strong content outscores vague content",
                totals["strong"] > totals["moderate"],
                f"strong={totals['strong']:.1f} vs moderate={totals['moderate']:.1f}",
                soft=True,
                strict=strict,
            )
        if {"strong", "off_topic"} <= totals.keys():
            section.record(
                "strong content outscores off-topic content",
                totals["strong"] > totals["off_topic"],
                f"strong={totals['strong']:.1f} vs off_topic={totals['off_topic']:.1f}",
                soft=True,
                strict=strict,
            )
        if {"strong", "gibberish"} <= totals.keys():
            section.record(
                "strong content outscores filler-only speech",
                totals["strong"] > totals["gibberish"],
                f"strong={totals['strong']:.1f} vs gibberish={totals['gibberish']:.1f}",
                soft=True,
                strict=strict,
            )

        # --- deterministic input guards ------------------------------------
        empty = await score_debate_content("", DEBATE_MOTION.title, DEBATE_MOTION.text)
        section.record(
            "empty transcript is rejected without calling the LLM",
            not empty.available and empty.total == 0,
            empty.error or "",
        )

        tiny = await score_debate_content("Yes I agree.", DEBATE_MOTION.title, DEBATE_MOTION.text)
        section.record(
            "sub-20-character transcript is rejected",
            not tiny.available,
            tiny.error or "",
        )

        no_motion = await score_debate_content(
            DEBATE_SAMPLES[0].text, "", ""
        )
        section.record(
            "missing motion is rejected",
            not no_motion.available,
            no_motion.error or "",
        )

    except Exception as exc:  # noqa: BLE001 - report instead of crashing the run
        section.error = f"{type(exc).__name__}: {exc}"
