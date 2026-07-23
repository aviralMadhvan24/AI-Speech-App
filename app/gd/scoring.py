"""GD-specific scoring: batch processes all speeches and computes final scores.

Scoring breakdown (100 points):
- Content Quality (30%): LLM-based content analysis across all speeches
- Communication (20%): Avg pronunciation + fluency across speeches
- Participation (20%): Speak time + speech count relative to peers
- Listening (15%): References to other speakers' points (LLM)
- Leadership (15%): First speaker, guiding discussion (heuristic)
"""

from __future__ import annotations

import logging
from typing import Optional

from app.core.llm_client import llm
from app.gd.schemas import (
    GDParticipantInternal,
    GDParticipantScore,
    GDRoom,
    GDSpeechRecord,
)

logger = logging.getLogger("gd.scoring")


async def score_gd_content(
    all_transcripts: dict[str, str],
    topic_title: str,
    topic_text: str,
) -> dict[str, tuple[float, str]]:
    """Score content quality per participant using LLM.
    
    Args:
        all_transcripts: {participant_id: combined_transcript}
        topic_title: GD topic title
        topic_text: GD topic full text
    
    Returns:
        {participant_id: (score_0_to_30, feedback)}
    """
    results: dict[str, tuple[float, str]] = {}
    
    if not llm.is_available:
        # Fallback: give everyone 15/30 if LLM unavailable
        for pid in all_transcripts:
            results[pid] = (15.0, "Content scoring unavailable")
        return results
    
    # Build combined context
    participants_text = "\n\n".join([
        f"PARTICIPANT_{i+1} (id: {pid}):\n{transcript[:1500]}"
        for i, (pid, transcript) in enumerate(all_transcripts.items())
    ])
    
    prompt = f"""You are a STRICT and CRITICAL GD evaluator for a professional interview setting. Score each participant's content quality.

GD TOPIC: {topic_title}
"{topic_text}"

PARTICIPANTS' CONTRIBUTIONS:
{participants_text}

SCORING CRITERIA (0-30 total, be STRICT):

1. RELEVANCE (0-10):
   - 0-2: Completely off-topic, irrelevant rambling
   - 3-5: Somewhat related but misses key points
   - 6-8: Good relevance with some tangents
   - 9-10: Perfectly on-topic throughout

2. DEPTH OF IDEAS (0-10):
   - 0-2: Superficial, no examples or reasoning
   - 3-5: Basic points with minimal elaboration
   - 6-8: Good arguments with some examples
   - 9-10: Deep insights, strong examples, logical reasoning

3. STRUCTURE & CLARITY (0-10):
   - 0-2: Incoherent, hard to follow
   - 3-5: Somewhat organized but jumps around
   - 6-8: Clear structure with good flow
   - 9-10: Excellent organization and articulation

IMPORTANT FEEDBACK RULES:
- Quote 2-3 EXACT phrases from their transcript to justify your score
- If content is OFF-TOPIC or IRRELEVANT, say "⚠️ OFF-TOPIC: [reason]"
- Be specific about what was good or bad
- For low scores (<15), explain clearly why they lost points
- Compare participants to each other when relevant

Respond with ONLY valid JSON:
{{"scores": [{{"id": "<participant_id>", "score": <0-30>, "feedback": "<detailed feedback with quotes>"}}]}}"""

    try:
        result = await llm.generate_json(prompt, max_tokens=1200)
        if result and "scores" in result:
            for entry in result["scores"]:
                pid = entry.get("id", "")
                score = max(0, min(30, float(entry.get("score", 0))))
                feedback = str(entry.get("feedback", ""))[:400]
                results[pid] = (score, feedback)
    except Exception as e:
        logger.warning(f"GD content scoring failed: {e}")
    
    # Fill in missing participants
    for pid in all_transcripts:
        if pid not in results:
            results[pid] = (15.0, "Score not available")
    
    return results


async def score_listening_skills(
    all_transcripts: dict[str, str],
    display_names: dict[str, str],
) -> dict[str, tuple[float, str]]:
    """Score listening skills based on references to other participants.
    
    Returns:
        {participant_id: (score_0_to_15, feedback)}
    """
    results: dict[str, tuple[float, str]] = {}
    
    if not llm.is_available:
        for pid in all_transcripts:
            results[pid] = (7.5, "Listening scoring unavailable")
        return results
    
    participants_text = "\n\n".join([
        f"{display_names.get(pid, pid)} (id: {pid}):\n{transcript[:1000]}"
        for pid, transcript in all_transcripts.items()
    ])
    
    prompt = f"""Evaluate LISTENING skills of each GD participant. Look for:
- References to other participants' points ("As X said...", "Building on that...")
- Building on others' ideas with new insights
- Acknowledging different perspectives
- Responding to what was said (not just monologuing)

PARTICIPANTS:
{participants_text}

Score each on LISTENING (0-15):
- 0-3: Never references others, only monologues
- 4-8: Some references but mostly own points
- 9-12: Good engagement, builds on others' ideas
- 13-15: Excellent - weaves others' points into arguments

FEEDBACK RULES:
- Quote EXACT phrases where they referenced others (or note absence)
- Be specific: "Referenced X's point about..." or "Never acknowledged other speakers"

Respond JSON only:
{{"scores": [{{"id": "<participant_id>", "score": <0-15>, "feedback": "<specific feedback with quotes>"}}]}}"""

    try:
        result = await llm.generate_json(prompt, max_tokens=800)
        if result and "scores" in result:
            for entry in result["scores"]:
                pid = entry.get("id", "")
                score = max(0, min(15, float(entry.get("score", 0))))
                feedback = str(entry.get("feedback", ""))[:250]
                results[pid] = (score, feedback)
    except Exception as e:
        logger.warning(f"Listening scoring failed: {e}")
    
    for pid in all_transcripts:
        if pid not in results:
            results[pid] = (7.5, "Score not available")
    
    return results


def compute_communication_score(speeches: list[GDSpeechRecord]) -> float:
    """Avg pronunciation + fluency across all speeches (0-20)."""
    if not speeches:
        return 0.0
    
    pron_scores = [s.pronunciation_score for s in speeches if s.pronunciation_score is not None]
    fluency_scores = [s.fluency_score for s in speeches if s.fluency_score is not None]
    
    avg_pron = sum(pron_scores) / len(pron_scores) if pron_scores else None
    avg_fluency = sum(fluency_scores) / len(fluency_scores) if fluency_scores else None
    
    # Scale to 20 points (each was 0-100)
    if avg_pron is not None and avg_fluency is not None:
        return round((avg_pron + avg_fluency) / 2.0 / 100.0 * 20.0, 2)
    if avg_fluency is not None:
        return round(avg_fluency / 100.0 * 20.0, 2)
    if avg_pron is not None:
        return round(avg_pron / 100.0 * 20.0, 2)
    return 0.0


def compute_participation_score(
    participant: GDParticipantInternal,
    all_participants: list[GDParticipantInternal],
    total_discussion_seconds: float = 900.0,
) -> float:
    """Score participation relative to peers (0-20).
    
    Considers:
    - Total speak time (10 pts)
    - Number of speeches (10 pts)
    """
    if not all_participants:
        return 0.0
    
    # Max values across all participants
    max_speak_time = max((p.total_speak_seconds for p in all_participants), default=1.0)
    max_speeches = max((p.speech_count for p in all_participants), default=1)
    
    # Ideal: 90-120 seconds total speak time (~2 min), 4-6 speeches
    ideal_speak_time = 120.0
    ideal_speeches = 5
    
    # Speak time score (10 points)
    if max_speak_time > 0:
        # Normalized against ideal, capped
        speak_ratio = min(1.0, participant.total_speak_seconds / ideal_speak_time)
        speak_score = speak_ratio * 10.0
    else:
        speak_score = 0.0
    
    # Speech count score (10 points)
    if max_speeches > 0:
        count_ratio = min(1.0, participant.speech_count / ideal_speeches)
        count_score = count_ratio * 10.0
    else:
        count_score = 0.0
    
    return round(speak_score + count_score, 2)


def compute_leadership_score(
    participant: GDParticipantInternal,
    all_participants: list[GDParticipantInternal],
) -> float:
    """Heuristic leadership score (0-15):
    - First speaker bonus (5 pts)
    - High engagement (5 pts): speech count > avg
    - Balanced (5 pts): interruption penalty
    """
    score = 0.0
    
    # First speaker bonus
    if participant.is_first_speaker:
        score += 5.0
    
    # Engagement bonus (speech count vs avg)
    if all_participants:
        avg_speeches = sum(p.speech_count for p in all_participants) / len(all_participants)
        if participant.speech_count > avg_speeches:
            score += 5.0
        elif participant.speech_count >= avg_speeches * 0.8:
            score += 3.0
    
    # Etiquette (fewer interruptions = better leadership)
    if participant.interruption_count == 0:
        score += 5.0
    elif participant.interruption_count <= 2:
        score += 3.0
    elif participant.interruption_count <= 4:
        score += 1.0
    # else: no bonus (too many interruptions)
    
    return round(min(15.0, score), 2)


async def compute_final_scores(
    room: GDRoom,
    persisted_speeches: list[GDSpeechRecord],
) -> list[GDParticipantScore]:
    """Compute final scores for all participants after GD ends."""
    logger.info(f"Computing final scores for GD {room.code}")
    
    # Group speeches by participant
    speeches_by_pid: dict[str, list[GDSpeechRecord]] = {}
    for sp in persisted_speeches:
        speeches_by_pid.setdefault(sp.participant_id, []).append(sp)
    
    # Build combined transcripts
    all_transcripts: dict[str, str] = {}
    display_names: dict[str, str] = {}
    for p in room.participants:
        speeches = speeches_by_pid.get(p.participant_id, [])
        transcripts = [s.transcript for s in speeches if s.transcript]
        all_transcripts[p.participant_id] = " ".join(transcripts) if transcripts else "(no speech)"
        display_names[p.participant_id] = p.display_name
    
    # Only score participants who spoke
    scoreable = {pid: t for pid, t in all_transcripts.items() if t != "(no speech)"}
    
    # Run LLM scoring in parallel
    content_scores = await score_gd_content(scoreable, room.topic_title, room.topic_text)
    listening_scores = await score_listening_skills(scoreable, display_names)
    
    # Compute all scores
    final_scores: list[GDParticipantScore] = []
    for p in room.participants:
        speeches = speeches_by_pid.get(p.participant_id, [])
        
        # Content Quality (0-30)
        content_result = content_scores.get(p.participant_id, (0.0, "Did not participate"))
        content_score = content_result[0]
        content_feedback = content_result[1]
        
        # Communication (0-20)
        comm_score = compute_communication_score(speeches)
        
        # Participation (0-20)
        part_score = compute_participation_score(p, room.participants)
        
        # Listening (0-15)
        listen_result = listening_scores.get(p.participant_id, (0.0, ""))
        listen_score = listen_result[0]
        listen_feedback = listen_result[1]
        
        # Leadership (0-15)
        lead_score = compute_leadership_score(p, room.participants)
        
        total = content_score + comm_score + part_score + listen_score + lead_score
        total = round(min(100.0, max(0.0, total)), 2)
        
        # Combined feedback with all details
        if p.speech_count == 0:
            feedback = "Did not participate in the discussion. No points can be awarded."
        else:
            feedback_parts = []
            
            # Content feedback (main)
            if content_feedback:
                feedback_parts.append(f"📝 Content: {content_feedback}")
            
            # Listening feedback
            if listen_feedback and listen_feedback != "Score not available":
                feedback_parts.append(f"👂 Listening: {listen_feedback}")
            
            # Leadership note
            if p.is_first_speaker:
                feedback_parts.append("🏆 Initiated the discussion (first speaker bonus)")
            
            # Interruption warning
            if p.interruption_count > 2:
                feedback_parts.append(f"⚠️ Too many interruptions ({p.interruption_count}x) - shows poor etiquette")
            
            feedback = " | ".join(feedback_parts) if feedback_parts else content_feedback
        
        final_scores.append(GDParticipantScore(
            participant_id=p.participant_id,
            display_name=p.display_name,
            total_score=total,
            content_quality=content_score,
            communication=comm_score,
            participation=part_score,
            listening=listen_score,
            leadership=lead_score,
            speech_count=p.speech_count,
            total_speak_seconds=round(p.total_speak_seconds, 2),
            interruption_count=p.interruption_count,
            was_interrupted_count=p.was_interrupted_count,
            feedback=feedback,
        ))
    
    # Rank by total score
    final_scores.sort(key=lambda s: s.total_score, reverse=True)
    for i, score in enumerate(final_scores):
        score.rank = i + 1
    
    return final_scores
