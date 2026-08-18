"""Content scoring for debate turns using LLM.

Evaluates the relevance, argument quality, structure, and vocabulary
of a speaker's transcript against the debate motion.

Scoring breakdown (50 points total):
- Relevance (0-15): Does it address the motion directly?
- Arguments (0-15): Are points logical and supported?
- Structure (0-10): Clear intro, body, conclusion?
- Vocabulary (0-10): Word variety, appropriate terms?
"""

import logging
from dataclasses import dataclass
from typing import Optional

from app.core.llm_client import LLMUnavailableError, llm
from app.core.llm_feedback import coerce_feedback

logger = logging.getLogger("debate.content_scoring")


@dataclass
class ContentScoreResult:
    """Result of content scoring analysis."""

    relevance: int  # 0-15
    arguments: int  # 0-15
    structure: int  # 0-10
    vocabulary: int  # 0-10
    total: int  # 0-50
    feedback: str  # One-line feedback
    available: bool  # Whether scoring succeeded
    error: Optional[str] = None  # Error message if failed
    off_topic: bool = False  # Speech did not address the motion at all

    def to_dict(self) -> dict:
        return {
            "relevance": self.relevance,
            "arguments": self.arguments,
            "structure": self.structure,
            "vocabulary": self.vocabulary,
            "total": self.total,
            "feedback": self.feedback,
            "available": self.available,
            "error": self.error,
            "off_topic": self.off_topic,
        }


def _build_scoring_prompt(transcript: str, motion_title: str, motion_text: str) -> str:
    """Build the LLM prompt for content scoring."""
    word_count = len(transcript.split())
    return f"""You are an EXTREMELY STRICT debate judge. Your feedback must quote EXACT phrases from the transcript.

DEBATE MOTION: {motion_title}
"{motion_text}"

STUDENT'S SPEECH ({word_count} words):
"{transcript}"

SCORING RULES:

**OFF-TOPIC = AUTOMATIC FAIL:**
- ANY sentence unrelated to motion → relevance: 0-3, ALL other scores: max 5 each
- Random topics (food, personal stuff, unrelated facts) → total under 15
- "off_topic" means the speech does NOT address the motion. Judge this on
  subject matter only. A SHORT speech that does address the motion is NOT
  off-topic — set "off_topic": false for it.

**LENGTH:**
- Do NOT reduce scores for a short speech. Length is penalised separately,
  after your judgement. Score only what was actually said.

**QUALITY:**
- Restating motion without argument = relevance 0-4
- "It's good/bad" without WHY = arguments 0-4

CRITERIA:
1. RELEVANCE (0-15): Every sentence must address motion
2. ARGUMENTS (0-15): Need specific examples/evidence  
3. STRUCTURE (0-10): Clear stance → points → conclusion
4. VOCABULARY (0-10): Persuasive language

**FEEDBACK CONTENT:**
Quote 2-3 exact phrases from the transcript, say what is wrong with each one
(off-topic / vague / unsupported), and end with ONE specific fix suggestion.

EXAMPLE FEEDBACK:
"The phrase 'pizza is really delicious' is completely OFF-TOPIC - the motion is about technology. 'I think it's bad' lacks evidence - say WHY, for example 'Technology causes X because Y'. Add specific arguments with data or real-world examples."

BAD FEEDBACK (too generic):
"The speech lacks relevance" - NO! Quote the actual problematic words!

**OUTPUT FORMAT - FOLLOW EXACTLY:**
- Return ONE JSON object. No Markdown, no text before or after it.
- "feedback" MUST be a single plain string. Never a list, never nested objects.
- When quoting the speech inside "feedback", use single quotes ('like this').
  Never use double quotes inside the string, as that breaks the JSON.
- All six score fields are integers.

{{"relevance": 0, "arguments": 0, "structure": 0, "vocabulary": 0, "total": 0, "off_topic": false, "feedback": "One string quoting the transcript with single quotes"}}
"""


def _create_unavailable_result(error: str) -> ContentScoreResult:
    """Create a result indicating scoring is unavailable."""
    return ContentScoreResult(
        relevance=0,
        arguments=0,
        structure=0,
        vocabulary=0,
        total=0,
        feedback=error,
        available=False,
        error=error,
    )


async def score_debate_content(
    transcript: str,
    motion_title: str,
    motion_text: str,
) -> ContentScoreResult:
    """Score the content relevance of a debate speech.

    Args:
        transcript: The speaker's transcribed speech
        motion_title: Title of the debate motion
        motion_text: Full text of the debate motion

    Returns:
        ContentScoreResult with breakdown scores and feedback
    """
    # Validate inputs
    if not transcript or len(transcript.strip()) < 20:
        return _create_unavailable_result("Transcript too short for content analysis")

    if not motion_title or not motion_text:
        return _create_unavailable_result("Motion information missing")

    if not llm.is_available:
        return _create_unavailable_result("LLM service not configured")

    # Calculate word count for length penalty
    word_count = len(transcript.strip().split())
    
    try:
        prompt = _build_scoring_prompt(transcript.strip(), motion_title, motion_text)
        try:
            result = await llm.generate_json(prompt, max_tokens=500)
        except LLMUnavailableError as exc:
            logger.warning("content scoring skipped: %s", exc)
            return _create_unavailable_result(f"Content not scored: {exc}.")

        if not result:
            return _create_unavailable_result("Could not parse LLM response")

        # Extract and validate scores
        relevance = max(0, min(15, int(result.get("relevance", 0))))
        arguments = max(0, min(15, int(result.get("arguments", 0))))
        structure = max(0, min(10, int(result.get("structure", 0))))
        vocabulary = max(0, min(10, int(result.get("vocabulary", 0))))
        is_off_topic = bool(result.get("off_topic", False))
        
        # Apply OFF-TOPIC penalty FIRST (most severe)
        # If LLM detected off-topic content, cap ALL scores severely
        if is_off_topic:
            # Off-topic content: cap each category at ~30% of max
            relevance = min(relevance, 4)  # max 4/15
            arguments = min(arguments, 4)  # max 4/15
            structure = min(structure, 3)  # max 3/10
            vocabulary = min(vocabulary, 3)  # max 3/10
            logger.info(f"Applied OFF-TOPIC penalty - content unrelated to motion")
        
        # Additional check: if relevance is very low (0-3), it means off-topic
        # Cap other scores proportionally
        if relevance <= 3:
            # Very low relevance = cap everything else too
            arguments = min(arguments, 5)
            structure = min(structure, 4)
            vocabulary = min(vocabulary, 4)
            logger.info(f"Low relevance ({relevance}) - capping other scores")
        
        # Apply programmatic length penalty (in case LLM is too lenient)
        # A good 2-minute turn should be 200-300 words
        # Under 100 words = cap at 60% of each score
        # Under 50 words = cap at 30% of each score
        # Under 30 words = cap at 15% of each score
        if word_count < 30:
            length_penalty = 0.15
            penalty_reason = f"Very short ({word_count} words)"
        elif word_count < 50:
            length_penalty = 0.30
            penalty_reason = f"Too short ({word_count} words)"
        elif word_count < 100:
            length_penalty = 0.60
            penalty_reason = f"Short response ({word_count} words)"
        elif word_count < 150:
            length_penalty = 0.85
            penalty_reason = None  # No penalty message for slightly short
        else:
            length_penalty = 1.0
            penalty_reason = None
        
        # Relevance as judged on the speech's actual content, before the length
        # penalty scales it down. The off-topic decision below must use this:
        # being brief is not the same as ignoring the motion, and mixing the two
        # let a short on-topic turn get branded off-topic.
        relevance_on_merit = relevance

        if length_penalty < 1.0:
            relevance = int(relevance * length_penalty)
            arguments = int(arguments * length_penalty)
            structure = int(structure * length_penalty)
            vocabulary = int(vocabulary * length_penalty)
            logger.info(f"Applied length penalty {length_penalty} for {word_count} words")

        # A speech is off-topic when the judge says so outright, or when
        # relevance collapsed on merit - never merely because it was short.
        off_topic_final = is_off_topic or relevance_on_merit <= 3

        total = relevance + arguments + structure + vocabulary
        feedback = coerce_feedback(result.get("feedback", ""))[:500]
        
        # Prepend warnings to feedback
        warnings = []
        if off_topic_final:
            warnings.append("⚠️ OFF-TOPIC CONTENT DETECTED")
        if penalty_reason:
            warnings.append(penalty_reason)
        
        if warnings:
            feedback = f"{'. '.join(warnings)}. {feedback}"

        logger.info(
            f"Content scored: relevance={relevance}, arguments={arguments}, "
            f"structure={structure}, vocabulary={vocabulary}, total={total}, "
            f"words={word_count}, off_topic={off_topic_final} "
            f"(relevance_on_merit={relevance_on_merit})"
        )

        # `off_topic` is surfaced on the result so the final score can gate on
        # it rather than relying on the total alone.
        return ContentScoreResult(
            relevance=relevance,
            arguments=arguments,
            structure=structure,
            vocabulary=vocabulary,
            total=total,
            feedback=feedback or "Score computed successfully",
            available=True,
            off_topic=off_topic_final,
        )

    except Exception as e:
        logger.warning(f"Content scoring failed: {type(e).__name__}: {e}")
        return _create_unavailable_result(f"Scoring error: {type(e).__name__}")
