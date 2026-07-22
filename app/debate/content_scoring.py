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
        }


def _build_scoring_prompt(transcript: str, motion_title: str, motion_text: str) -> str:
    """Build the LLM prompt for content scoring."""
    word_count = len(transcript.split())
    return f"""You are a VERY STRICT debate judge. Students need honest feedback to improve - do NOT give high scores for mediocre speeches.

DEBATE MOTION: {motion_title}
"{motion_text}"

STUDENT'S SPEECH TRANSCRIPT ({word_count} words):
"{transcript}"

CRITICAL RULES:
- A 2-minute debate turn should have 200-300 words minimum
- Short speeches (under 100 words) should score LOW on all criteria
- Generic statements without specific arguments = LOW scores
- Repeating the motion without analysis = LOW scores  
- Vague points without examples = LOW scores

Score STRICTLY on these criteria:

1. RELEVANCE (0-15): Does it directly address the motion with specific points?
   - 13-15: Multiple specific points directly tied to motion
   - 9-12: Addresses motion but lacks depth
   - 5-8: Vague connection, generic statements
   - 0-4: Off topic or just restates motion

2. ARGUMENTS (0-15): Are points logical with evidence/examples?
   - 13-15: Clear reasoning WITH specific examples or evidence
   - 9-12: Decent logic but weak support
   - 5-8: Claims without support, weak logic
   - 0-4: No real arguments, just opinions

3. STRUCTURE (0-10): Clear organization (intro, points, conclusion)?
   - 8-10: Clear opening, organized points, strong conclusion
   - 5-7: Some structure but weak transitions
   - 0-4: Rambling, no clear flow

4. VOCABULARY (0-10): Word variety, debate terminology?
   - 8-10: Rich vocabulary, persuasive language
   - 5-7: Adequate but repetitive
   - 0-4: Very limited, colloquial only

LENGTH PENALTY: If under 100 words, cap each category at 50% of max.
If under 50 words, cap at 25% of max.

Respond with ONLY valid JSON (no explanation, no markdown):
{{"relevance": <0-15>, "arguments": <0-15>, "structure": <0-10>, "vocabulary": <0-10>, "total": <0-50>, "feedback": "<one honest sentence about what needs improvement>"}}"""


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
        result = await llm.generate_json(prompt, max_tokens=300)

        if not result:
            return _create_unavailable_result("Could not parse LLM response")

        # Extract and validate scores
        relevance = max(0, min(15, int(result.get("relevance", 0))))
        arguments = max(0, min(15, int(result.get("arguments", 0))))
        structure = max(0, min(10, int(result.get("structure", 0))))
        vocabulary = max(0, min(10, int(result.get("vocabulary", 0))))
        
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
        feedback = str(result.get("feedback", ""))[:200]
        
        # Append length warning to feedback if applicable
        if penalty_reason:
            feedback = f"{penalty_reason}. {feedback}"

        logger.info(
            f"Content scored: relevance={relevance}, arguments={arguments}, "
            f"structure={structure}, vocabulary={vocabulary}, total={total}, words={word_count}"
        )

        return ContentScoreResult(
            relevance=relevance,
            arguments=arguments,
            structure=structure,
            vocabulary=vocabulary,
            total=total,
            feedback=feedback or "Score computed successfully",
            available=True,
        )

    except Exception as e:
        logger.warning(f"Content scoring failed: {type(e).__name__}: {e}")
        return _create_unavailable_result(f"Scoring error: {type(e).__name__}")
