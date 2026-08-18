"""Interview answer content scoring using Groq LLM.

Evaluates the quality of a student's spoken answer to an interview question.
Scores on STAR method, relevance, depth, and communication.

Scoring (0-100):
- Relevance to question (25): Does it actually answer what was asked?
- Structure/STAR method (25): Clear situation, task, action, result?
- Depth & specificity (25): Concrete examples? Detailed enough?
- Communication clarity (25): Well-articulated? Logical flow?
"""

import logging
from typing import Optional

from pydantic import BaseModel

from app.core.llm_client import llm
from app.core.llm_feedback import coerce_feedback

logger = logging.getLogger("interview.content_scoring")


class AnswerScoreResult(BaseModel):
    """Result of AI answer content scoring."""
    
    relevance: int = 0  # 0-25
    structure: int = 0  # 0-25
    depth: int = 0  # 0-25
    communication: int = 0  # 0-25
    total: int = 0  # 0-100
    feedback: str = ""
    strengths: str = ""
    improvements: str = ""
    available: bool = False
    error: Optional[str] = None


async def score_interview_answer(
    transcript: str,
    question_prompt: str,
    question_category: str = "general",
) -> AnswerScoreResult:
    """Score the content quality of an interview answer using LLM.
    
    Args:
        transcript: What the student said (from Whisper ASR)
        question_prompt: The interview question asked
        question_category: Category (behavioural, technical, situational)
    
    Returns:
        AnswerScoreResult with breakdown and feedback
    """
    if not transcript or len(transcript.strip()) < 30:
        return AnswerScoreResult(
            error="Answer too short for content analysis",
            feedback="Your answer was too brief to evaluate. Try speaking for at least 30 seconds.",
        )
    
    if not llm.is_available:
        return AnswerScoreResult(error="AI scoring service not available")

    word_count = len(transcript.split())
    prompt = f"""You are an expert interview coach evaluating a student's answer. Be supportive but honest - they need real feedback to improve. Your feedback must quote EXACT phrases from their answer.

INTERVIEW QUESTION ({question_category}):
"{question_prompt}"

STUDENT'S ANSWER ({word_count} words, transcribed from audio):
"{transcript[:2000]}"

Score the answer on these criteria (0-25 each, total 0-100):

1. RELEVANCE (0-25): Does it directly answer the question?
   - 20-25: Perfectly on topic, addresses all parts
   - 15-19: Mostly relevant, minor tangents
   - 10-14: Partially answers the question
   - 0-9: Off topic or doesn't answer

2. STRUCTURE (0-25): Is it well-organized? (STAR method for behavioural)
   - 20-25: Clear intro, body, conclusion / STAR format
   - 15-19: Reasonable structure
   - 10-14: Somewhat disorganized
   - 0-9: Rambling, no structure

3. DEPTH (0-25): Specific examples? Concrete details?
   - 20-25: Great examples, specific numbers/results
   - 15-19: Some examples provided
   - 10-14: Vague, generic statements
   - 0-9: No supporting evidence

4. COMMUNICATION (0-25): Clear expression? Logical flow?
   - 20-25: Articulate, confident, logical
   - 15-19: Generally clear
   - 10-14: Some confusion or filler
   - 0-9: Unclear, hard to follow

**FEEDBACK CONTENT - QUOTE THE ANSWER:**
Every text field must respond to what THIS student actually said. Quote their
exact words back to them:

- "feedback": quote 2-3 exact phrases, say what each one does well or badly,
  and end with ONE specific fix.
- "strengths": quote the single strongest phrase they said and say why it works.
- "improvements": quote the weakest phrase and say exactly how to rewrite it.

If the answer is off topic, quote the off-topic words rather than describing
them, and score relevance accordingly.

EXAMPLE FEEDBACK (good - quotes the answer):
"You open with 'I led a team of four to ship the billing dashboard', which is a strong concrete setup. But 'it went pretty well' gives no result - replace it with the actual outcome, such as 'we cut support tickets by 30 percent'. Closing on 'yeah that's basically it' undercuts a solid answer - end on the result instead."

BAD FEEDBACK (too generic):
"Good structure but needs more specific examples." - NO! That sentence could describe any answer ever given. Quote their actual words.

**OUTPUT FORMAT - FOLLOW EXACTLY:**
- Return ONE JSON object. No Markdown, no text before or after it.
- "feedback", "strengths" and "improvements" MUST each be a single plain
  string. Never a list, never nested objects.
- When quoting the answer inside a string, use single quotes ('like this').
  Never use double quotes inside the string, as that breaks the JSON.
- All five numeric fields are integers.

{{"relevance": <0-25>, "structure": <0-25>, "depth": <0-25>, "communication": <0-25>, "total": <0-100>, "feedback": "<2-3 sentences quoting their exact words>", "strengths": "<quote the strongest phrase and why it works>", "improvements": "<quote the weakest phrase and how to rewrite it>"}}"""

    try:
        result = await llm.generate_json(prompt, max_tokens=400)
        
        if not result:
            return AnswerScoreResult(
                error="Could not parse AI response",
                feedback="AI scoring temporarily unavailable. Please try again.",
            )
        
        relevance = max(0, min(25, int(result.get("relevance", 0))))
        structure = max(0, min(25, int(result.get("structure", 0))))
        depth = max(0, min(25, int(result.get("depth", 0))))
        communication = max(0, min(25, int(result.get("communication", 0))))
        total = relevance + structure + depth + communication
        
        return AnswerScoreResult(
            relevance=relevance,
            structure=structure,
            depth=depth,
            communication=communication,
            total=total,
            feedback=coerce_feedback(result.get("feedback", ""))[:500],
            strengths=coerce_feedback(result.get("strengths", ""))[:200],
            improvements=coerce_feedback(result.get("improvements", ""))[:200],
            available=True,
        )
    except Exception as e:
        logger.warning(f"Interview content scoring failed: {type(e).__name__}: {e}")
        return AnswerScoreResult(
            error=f"Scoring error: {type(e).__name__}",
            feedback="AI scoring temporarily unavailable.",
        )
