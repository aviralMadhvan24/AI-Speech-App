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
    
    if not all_transcripts:
        logger.warning("No transcripts to score")
        return results
    
    if not llm.is_available:
        logger.warning("LLM not available for GD content scoring")
        for pid in all_transcripts:
            results[pid] = (15.0, "Content scoring unavailable - LLM not configured")
        return results
    
    # Create simple numbered mapping for LLM
    pid_list = list(all_transcripts.keys())
    pid_to_num = {pid: f"P{i+1}" for i, pid in enumerate(pid_list)}
    num_to_pid = {f"P{i+1}": pid for i, pid in enumerate(pid_list)}
    
    # Build combined context with simple IDs
    participants_text = "\n\n".join([
        f"{pid_to_num[pid]}:\n{transcript[:1500]}"
        for pid, transcript in all_transcripts.items()
    ])
    
    prompt = f"""You are a STRICT GD evaluator. Score each participant's content quality.

TOPIC: {topic_title}
"{topic_text}"

PARTICIPANTS:
{participants_text}

Score each on CONTENT (0-30):
- Relevance to topic (0-10)
- Depth of ideas (0-10)
- Clarity (0-10)

Rules:
- Quote exact phrases to justify scores
- Be specific about what was good/bad
- If off-topic, mark as "OFF-TOPIC"

Return JSON only:
{{"scores": [{{"id": "P1", "score": 20, "feedback": "Good points about X. Quoted: 'exact phrase'"}}]}}"""

    try:
        logger.info(f"Calling LLM for GD content scoring: {pid_to_num}")
        result = await llm.generate_json(prompt, max_tokens=1000)
        logger.info(f"LLM content response: {result}")
        
        if result and "scores" in result:
            for entry in result["scores"]:
                num_id = entry.get("id", "")
                # Map back to actual participant ID
                actual_pid = num_to_pid.get(num_id)
                if actual_pid:
                    score = max(0, min(30, float(entry.get("score", 15))))
                    feedback = str(entry.get("feedback", ""))[:400]
                    results[actual_pid] = (score, feedback)
                    logger.info(f"Scored {num_id} -> {actual_pid}: {score}/30")
                else:
                    logger.warning(f"Unknown participant ID from LLM: {num_id}")
        else:
            logger.warning(f"LLM returned invalid response: {result}")
    except Exception as e:
        logger.error(f"GD content scoring failed: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
    
    # Fill in missing participants
    for pid in all_transcripts:
        if pid not in results:
            logger.warning(f"No score for {pid}, using default")
            results[pid] = (15.0, "AI scoring unavailable")
    
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
    
    if not all_transcripts:
        return results
    
    # For single player, skip listening scoring (no one to reference)
    if len(all_transcripts) <= 1:
        for pid in all_transcripts:
            results[pid] = (7.5, "Single participant - listening N/A")
        return results
    
    if not llm.is_available:
        logger.warning("LLM not available for listening scoring")
        for pid in all_transcripts:
            results[pid] = (7.5, "Listening scoring unavailable")
        return results
    
    # Simple numbered mapping
    pid_list = list(all_transcripts.keys())
    pid_to_num = {pid: f"P{i+1}" for i, pid in enumerate(pid_list)}
    num_to_pid = {f"P{i+1}": pid for i, pid in enumerate(pid_list)}
    
    participants_text = "\n\n".join([
        f"{pid_to_num[pid]} ({display_names.get(pid, 'Unknown')}):\n{transcript[:800]}"
        for pid, transcript in all_transcripts.items()
    ])
    
    prompt = f"""Score LISTENING skills of each GD participant (0-15).

Look for:
- References to others ("As P1 said...", "Building on that...")
- Acknowledging others' points

PARTICIPANTS:
{participants_text}

Scoring:
- 0-5: Never references others
- 6-10: Some references
- 11-15: Actively builds on others

Return JSON only:
{{"scores": [{{"id": "P1", "score": 8, "feedback": "Referenced P2's point about X"}}]}}"""

    try:
        logger.info(f"Calling LLM for listening scoring: {pid_to_num}")
        result = await llm.generate_json(prompt, max_tokens=600)
        logger.info(f"Listening LLM response: {result}")
        
        if result and "scores" in result:
            for entry in result["scores"]:
                num_id = entry.get("id", "")
                actual_pid = num_to_pid.get(num_id)
                if actual_pid:
                    score = max(0, min(15, float(entry.get("score", 7.5))))
                    feedback = str(entry.get("feedback", ""))[:200]
                    results[actual_pid] = (score, feedback)
        else:
            logger.warning(f"Listening LLM invalid response: {result}")
    except Exception as e:
        logger.error(f"Listening scoring failed: {type(e).__name__}: {e}")
    
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
    logger.info(f"Computing final scores for GD {room.code} with {len(persisted_speeches)} persisted speeches")
    
    # Group speeches by participant
    speeches_by_pid: dict[str, list[GDSpeechRecord]] = {}
    for sp in persisted_speeches:
        speeches_by_pid.setdefault(sp.participant_id, []).append(sp)
    
    # Calculate actual stats from persisted speeches (more accurate than in-memory)
    persisted_stats: dict[str, dict] = {}
    for pid, speeches in speeches_by_pid.items():
        total_duration = sum(s.duration_seconds or 0.0 for s in speeches)
        persisted_stats[pid] = {
            "speech_count": len(speeches),
            "total_speak_seconds": total_duration,
        }
        logger.info(f"Participant {pid}: {len(speeches)} speeches, {total_duration:.1f}s total")
    
    # Build combined transcripts
    all_transcripts: dict[str, str] = {}
    display_names: dict[str, str] = {}
    for p in room.participants:
        speeches = speeches_by_pid.get(p.participant_id, [])
        transcripts = [s.transcript for s in speeches if s.transcript]
        all_transcripts[p.participant_id] = " ".join(transcripts) if transcripts else "(no speech)"
        display_names[p.participant_id] = p.display_name
        
        # Update participant with accurate persisted stats
        stats = persisted_stats.get(p.participant_id, {"speech_count": 0, "total_speak_seconds": 0.0})
        p.speech_count = stats["speech_count"]
        p.total_speak_seconds = stats["total_speak_seconds"]
    
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

        # Content gate: participation and delivery alone must not carry someone
        # who never engaged with the topic. Without this, an off-topic speaker
        # scoring 0/30 on content still finished in the mid-30s on the strength
        # of speak time and clarity.
        is_off_topic = "OFF-TOPIC" in (content_feedback or "").upper()
        if p.speech_count > 0:
            if content_score <= 0 or is_off_topic:
                total = round(min(total, 25.0), 2)
                logger.info(
                    f"Off-topic/zero-content gate for {p.display_name}: capped at 25"
                )
            elif content_score <= 5:
                total = round(min(total, 40.0), 2)
                logger.info(
                    f"Low content ({content_score}/30) for {p.display_name}: capped at 40"
                )
        
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
