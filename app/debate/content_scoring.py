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
    return f"""You are an EXTREMELY STRICT debate judge. Off-topic content is UNACCEPTABLE and must receive near-zero scores.

DEBATE MOTION: {motion_title}
"{motion_text}"

STUDENT'S SPEECH TRANSCRIPT ({word_count} words):
"{transcript}"

CRITICAL SCORING RULES (MUST FOLLOW):

**OFF-TOPIC PENALTY (MOST IMPORTANT):**
- If ANY sentence is completely unrelated to the motion → RELEVANCE must be 0-3
- If speaker talks about random topics (food, weather, personal life) not connected to motion → ALL scores capped at 5 max each
- Example: Motion about "technology in education" but speaker says "pizza is nice" → TOTAL SCORE should be under 15

**LENGTH REQUIREMENTS:**
- Under 50 words = max 25% of each category
- Under 100 words = max 50% of each category
- A proper 2-minute turn needs 200-300 words

**QUALITY REQUIREMENTS:**
- Just restating the motion = relevance 0-4
- Generic statements like "it's good/bad" without WHY = arguments 0-4
- No examples or evidence = arguments capped at 8

SCORING CRITERIA:

1. RELEVANCE (0-15): 
   - 13-15: EVERY sentence directly addresses motion with specific points
   - 9-12: Mostly relevant but 1-2 vague/generic statements
   - 5-8: Partially relevant, some off-topic wandering
   - 1-4: Mostly off-topic or just restates motion
   - 0: Completely irrelevant to the motion

2. ARGUMENTS (0-15):
   - 13-15: Clear reasoning WITH specific real-world examples/evidence
   - 9-12: Decent logic but vague examples
   - 5-8: Claims without support
   - 0-4: No arguments, just random statements

3. STRUCTURE (0-10):
   - 8-10: Clear stance → organized points → strong conclusion
   - 5-7: Some structure but weak
   - 0-4: Rambling, no flow

4. VOCABULARY (0-10):
   - 8-10: Persuasive language, good word choice
   - 5-7: Basic but acceptable
   - 0-4: Poor vocabulary, slang, filler words

**ALSO RETURN:** Set "off_topic" to true if ANY part of speech is completely unrelated to motion, false otherwise.

FEEDBACK MUST:
1. Quote specific problematic phrases in "quotation marks"
2. Explain WHY they're wrong (off-topic, vague, unsupported)
3. Give specific improvement suggestion

Respond with ONLY valid JSON:
{{"relevance": <0-15>, "arguments": <0-15>, "structure": <0-10>, "vocabulary": <0-10>, "total": <0-50>, "off_topic": <true/false>, "feedback": "<detailed feedback quoting specific problems>"}}"""""""""


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
