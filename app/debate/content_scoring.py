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

from app.core.llm_client import llm

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

**LENGTH REQUIREMENTS:**
- Under 50 words = all scores capped at 25%
- Under 100 words = all scores capped at 50%

**QUALITY:**
- Restating motion without argument = relevance 0-4
- "It's good/bad" without WHY = arguments 0-4

CRITERIA:
1. RELEVANCE (0-15): Every sentence must address motion
2. ARGUMENTS (0-15): Need specific examples/evidence  
3. STRUCTURE (0-10): Clear stance → points → conclusion
4. VOCABULARY (0-10): Persuasive language

**FEEDBACK FORMAT - YOU MUST:**
1. Quote 2-3 EXACT phrases from transcript in "quotation marks"
2. For EACH quote, say what's wrong: off-topic/vague/unsupported/etc
3. Give ONE specific fix suggestion

EXAMPLE FEEDBACK:
"Your phrase 'pizza is really delicious' is completely OFF-TOPIC - the motion is about technology. Also, 'I think it's bad' lacks evidence - say WHY with examples like 'Technology causes X because Y'. Add specific arguments with data or real-world examples."

BAD FEEDBACK (too generic):
"The speech lacks relevance" - NO! Quote the actual problematic words!

Respond with ONLY valid JSON:
{{"relevance": <0-15>, "arguments": <0-15>, "structure": <0-10>, "vocabulary": <0-10>, "total": <0-50>, "off_topic": <true/false>, "feedback": "<MUST quote exact phrases from transcript with specific criticism>"}}"""""""""


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
        result = await llm.generate_json(prompt, max_tokens=500)

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
        
        if length_penalty < 1.0:
            relevance = int(relevance * length_penalty)
            arguments = int(arguments * length_penalty)
            structure = int(structure * length_penalty)
            vocabulary = int(vocabulary * length_penalty)
            logger.info(f"Applied length penalty {length_penalty} for {word_count} words")
        
        total = relevance + arguments + structure + vocabulary
        feedback = str(result.get("feedback", ""))[:500]  # Allow longer detailed feedback
        
        # Prepend warnings to feedback
        warnings = []
        if is_off_topic:
            warnings.append("⚠️ OFF-TOPIC CONTENT DETECTED")
        if penalty_reason:
            warnings.append(penalty_reason)
        
        if warnings:
            feedback = f"{'. '.join(warnings)}. {feedback}"

        logger.info(
            f"Content scored: relevance={relevance}, arguments={arguments}, "
            f"structure={structure}, vocabulary={vocabulary}, total={total}, words={word_count}"
        )

        # A speech is treated as off-topic when the judge says so outright, or
        # when relevance collapsed to near-zero. Surfaced on the result so the
        # final score can gate on it rather than relying on the total alone.
        return ContentScoreResult(
            relevance=relevance,
            arguments=arguments,
            structure=structure,
            vocabulary=vocabulary,
            total=total,
            feedback=feedback or "Score computed successfully",
            available=True,
            off_topic=is_off_topic or relevance <= 3,
        )

    except Exception as e:
        logger.warning(f"Content scoring failed: {type(e).__name__}: {e}")
        return _create_unavailable_result(f"Scoring error: {type(e).__name__}")
