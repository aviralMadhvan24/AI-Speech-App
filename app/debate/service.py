"""Debate turn analysis service.

Inlines the same pipeline used by ``POST /analyze`` (``analyze_audio`` in
``app.api.analysis_routes``) but adapted for a debate turn:

- No ``expected_text`` is supplied — debate turns are free-form speech.
- The ``communication`` section is marked N/A for debate turns.
- The ``debug`` section is a stub (no transcript comparison).
- ``save_attempt`` failures are swallowed at WARNING so a persistence
  hiccup never blocks a turn from being recorded upstream.

Public callables:

- ``analyze_turn_audio(file, user)``: runs the full pipeline and returns
  ``(audio_asset, transcription, pronunciation, fluency, analysis_id)``
  for the room manager to combine with participant/turn metadata.
- ``compute_ai_score(pronunciation, fluency)``: pure function that folds
  the two per-turn signals into a single 0–100 score, returning also a
  boolean flag when neither signal was usable.
- ``compute_ai_score_with_content(...)``: enhanced scoring including LLM
  content analysis (relevance, arguments, structure, vocabulary).
"""

from typing import Optional
from uuid import uuid4

from fastapi import UploadFile

from app.asr.schemas import TranscriptionResult
from app.asr.whisper_service import transcribe_audio
from app.attempts.schemas import build_attempt_summary
from app.attempts.storage import save_attempt
from app.audio.preprocessing import preprocess_audio_asset
from app.audio.schemas import AudioAsset
from app.audio.storage import save_uploaded_audio
from app.auth import User
from app.core.logging_helpers import logger
from app.core.logging_helpers import stage_log
from app.debate.content_scoring import score_debate_content, ContentScoreResult
from app.fluency.schemas import FluencyResult
from app.fluency.service import build_fluency_section
from app.schemas.pronunciation_schema import AnalyzeResponse
from app.schemas.pronunciation_schema import PronunciationResult


async def analyze_turn_audio(
    file: UploadFile,
    user: User,
) -> tuple[AudioAsset, TranscriptionResult, PronunciationResult, FluencyResult, str]:
    """Run the full analysis pipeline for a single debate turn.

    Mirrors ``app.api.analysis_routes.analyze_audio`` step-for-step, minus
    the transcript-comparison branch (no ``expected_text`` for debate) and
    with a debate-specific ``communication`` stub. Persistence via
    ``save_attempt`` is best-effort; failures are logged and swallowed.

    Args:
        file: The uploaded audio blob from the turn upload endpoint.
        user: The authenticated caller (kept for parity with the analyze
            route; not used inside the pipeline itself).

    Returns:
        A 5-tuple ``(audio_asset, transcription, pronunciation, fluency,
        analysis_id)`` for the room manager to persist as a ``DebateTurn``.
    """
    analysis_id = str(uuid4())

    logger.info(
        stage_log(
            "debate_turn_received",
            analysis_id,
            content_type=file.content_type,
            size_hint=getattr(file, "size", None) or "unknown",
        )
    )

    audio_asset = await save_uploaded_audio(file)
    logger.info(
        stage_log(
            "audio_saved",
            analysis_id,
            audio_id=audio_asset.audio_id,
            size_bytes=audio_asset.size_bytes,
        )
    )

    audio_asset = preprocess_audio_asset(audio_asset)
    logger.info(
        stage_log(
            "audio_preprocessed",
            analysis_id,
            audio_id=audio_asset.audio_id,
            duration=audio_asset.duration_seconds,
        )
    )

    transcription = transcribe_audio(audio_asset.processed_path)
    logger.info(
        stage_log(
            "asr_done",
            analysis_id,
            provider=transcription.provider,
            word_count=len(transcription.words),
        )
    )

    # NOTE: We intentionally SKIP the HF phoneme pronunciation model for
    # debate turns. On CPU it takes 60-110s for a 1-2 minute free-form
    # speech (whole-audio wav2vec2 inference + phoneme alignment against the
    # full transcript). That routinely blew past the 135s turn timer, which
    # caused the turn to be forfeited (ai_score=0) before the real score
    # could be saved — and it made uploads feel like they hung for minutes.
    #
    # Debate scoring is about CONTENT and FLUENCY, not per-phoneme accuracy,
    # so we score on fluency (clarity/pace from ASR) + LLM content only.
    # `compute_ai_score_with_content` rescales to 0-100 when pronunciation
    # is absent.
    pronunciation = PronunciationResult(
        available=False,
        provider="skipped_for_debate",
        overall_score=None,
        words=[],
        phoneme_errors=[],
        message="Phoneme pronunciation is not scored for debate turns.",
    )
    logger.info(
        stage_log(
            "pronunciation_skipped",
            analysis_id,
            reason="debate_turn_speed",
        )
    )

    fluency = build_fluency_section(
        transcription=transcription,
        audio_asset=audio_asset,
    )
    logger.info(
        stage_log(
            "fluency_done",
            analysis_id,
            wpm=fluency.words_per_minute,
            clarity=fluency.clarity_score,
        )
    )

    response = AnalyzeResponse(
        analysis_id=analysis_id,
        audio=audio_asset,
        transcription=transcription,
        pronunciation=pronunciation,
        fluency=fluency,
        communication={
            "available": False,
            "provider": None,
            "overall_score": None,
            "rubric_version": None,
            "message": "N/A for debate turns",
        },
        debug={
            "expected_text_provided": False,
            "expected_text": None,
            "transcript_match_score": None,
            "transcript_mistakes": [],
        },
    )

    try:
        save_attempt(
            build_attempt_summary(
                analysis_id=analysis_id,
                response_data=response.model_dump(),
            )
        )
    except Exception as exc:
        logger.warning(
            stage_log(
                "attempt_persist_failed",
                analysis_id,
                exc=type(exc).__name__,
            )
        )

    return audio_asset, transcription, pronunciation, fluency, analysis_id


def compute_ai_score(
    pronunciation: PronunciationResult,
    fluency: FluencyResult,
) -> tuple[float, bool]:
    """Fold pronunciation and fluency signals into a single 0–100 score.

    Priority (per design section "AI Score Computation"):

    1. Both pronunciation (available) and fluency clarity present →
       average of the two, clamped to ``[0, 100]``, rounded to 2 decimals.
       ``scoring_unavailable`` is ``False``.
    2. Only fluency clarity present → clarity value, clamped and rounded.
       ``scoring_unavailable`` is ``False``.
    3. Neither present → ``(0.0, True)`` so upstream can flag the turn as
       lacking scoreable content while still persisting a numeric score.

    Args:
        pronunciation: Result from ``assess_pronunciation``. May be
            ``None`` or have ``available=False``; both are treated as
            "pronunciation missing".
        fluency: Result from ``build_fluency_section``. ``clarity_score``
            may be ``None``.

    Returns:
        A tuple ``(ai_score, scoring_unavailable)``.
    """
    pron = (
        pronunciation.overall_score
        if pronunciation is not None and pronunciation.available
        else None
    )
    clarity = fluency.clarity_score if fluency is not None else None
    if pron is not None and clarity is not None:
        return (
            round(max(0.0, min(100.0, (float(pron) + float(clarity)) / 2.0)), 2),
            False,
        )
    if clarity is not None:
        return round(max(0.0, min(100.0, float(clarity))), 2), False
    return 0.0, True



async def compute_ai_score_with_content(
    pronunciation: PronunciationResult,
    fluency: FluencyResult,
    transcript: str,
    motion_title: str,
    motion_text: str,
) -> tuple[float, bool, dict]:
    """Enhanced AI scoring including content analysis.

    Scoring weights:
    - Pronunciation: 25% (0-25 points from 0-100 score)
    - Fluency: 25% (0-25 points from clarity 0-100)
    - Content: 50% (0-50 points from LLM analysis)

    Total: 0-100 points

    Args:
        pronunciation: Result from pronunciation assessment
        fluency: Result from fluency analysis
        transcript: Speaker's transcribed text
        motion_title: Debate motion title
        motion_text: Debate motion full text

    Returns:
        Tuple of (final_score, scoring_unavailable, breakdown_dict)
    """
    # Get pronunciation score (0-100 -> 0-25)
    pron_raw = (
        pronunciation.overall_score
        if pronunciation is not None and pronunciation.available
        else None
    )
    pron_score = (pron_raw / 100.0 * 25.0) if pron_raw is not None else None

    # Get fluency clarity score (0-100 -> 0-25)
    clarity_raw = fluency.clarity_score if fluency is not None else None
    fluency_score = (clarity_raw / 100.0 * 25.0) if clarity_raw is not None else None

    # Get content score from LLM (0-50)
    content_result: Optional[ContentScoreResult] = None
    content_score: Optional[float] = None
    content_feedback: str = ""

    if transcript and len(transcript.strip()) >= 20:
        try:
            content_result = await score_debate_content(
                transcript=transcript,
                motion_title=motion_title,
                motion_text=motion_text,
            )
            if content_result.available:
                content_score = float(content_result.total)
                content_feedback = content_result.feedback
                logger.info(
                    stage_log(
                        "content_scoring_done",
                        "",
                        total=content_result.total,
                        relevance=content_result.relevance,
                        arguments=content_result.arguments,
                    )
                )
            else:
                content_feedback = content_result.error or "Content scoring unavailable"
        except Exception as exc:
            logger.warning(f"Content scoring failed: {type(exc).__name__}: {exc}")
            content_feedback = f"Content scoring error: {type(exc).__name__}"

    # Build breakdown dict
    breakdown = {
        "pronunciation": {
            "raw": pron_raw,
            "weighted": round(pron_score, 2) if pron_score else None,
            "weight": "25%",
        },
        "fluency": {
            "raw": clarity_raw,
            "weighted": round(fluency_score, 2) if fluency_score else None,
            "weight": "25%",
        },
        "content": {
            "total": content_score,
            "weight": "50%",
            "feedback": content_feedback,
            "details": content_result.to_dict() if content_result else None,
        },
    }

    # Calculate final score by summing the components that are actually
    # available, then rescaling to 0-100 based on the maximum achievable
    # from those same components. This keeps the score on a 0-100 scale no
    # matter which signals are present:
    #   - pronunciation contributes up to 25
    #   - fluency contributes up to 25
    #   - content contributes up to 50
    # e.g. debate turns skip pronunciation, so max achievable = 75 and we
    # scale the (fluency + content) sum up by 100/75.
    #
    # IMPORTANT: If content score is 0 or very low (off-topic/irrelevant),
    # we cap the final score severely because in a debate, CONTENT IS KING.
    # Good fluency on garbage content should still result in a low score.
    
    earned = 0.0
    max_possible = 0.0
    if pron_score is not None:
        earned += pron_score
        max_possible += 25.0
    if fluency_score is not None:
        earned += fluency_score
        max_possible += 25.0
    if content_score is not None:
        earned += content_score
        max_possible += 50.0

    if max_possible <= 0:
        breakdown["final_score"] = 0.0
        breakdown["scoring_unavailable"] = True
        return 0.0, True, breakdown

    # Calculate base score
    final_score = round(max(0.0, min(100.0, earned / max_possible * 100.0)), 2)

    if content_score is None:
        # Content is half the rubric. With no content evidence we cannot claim a
        # high score, so delivery alone is scored out of 50 instead of being
        # rescaled to 100. Without this, a fluent but completely off-topic turn
        # scored in the 80s purely on clarity.
        final_score = round(final_score / 2.0, 2)
        breakdown["final_score"] = final_score
        breakdown["scoring_unavailable"] = False
        breakdown["content_missing"] = True
        breakdown["content"]["feedback"] = (
            f"{content_feedback} Delivery scored out of 50 because content could "
            "not be assessed; ask your teacher to review."
        ).strip()
        logger.info(
            "content unavailable: delivery-only score halved to %s", final_score
        )
        return final_score, False, breakdown

    # CONTENT PENALTY: content is 50% of the rubric, so weak or irrelevant
    # content caps the final score no matter how clean the delivery was.
    if content_result is not None and content_result.off_topic:
        # Hard gate: nothing that ignores the motion can look like a pass.
        final_score = min(final_score, 20.0)
        logger.info("Off-topic gate applied: capping final score at 20")

    if content_score == 0:
        final_score = min(final_score, 15.0)
        logger.info("Content=0 penalty applied: capping final score at 15")
    elif content_score <= 5:
        final_score = min(final_score, 25.0)
        logger.info(f"Low content ({content_score}) penalty: capping at 25")
    elif content_score <= 10:
        final_score = min(final_score, 35.0)
        logger.info(f"Low content ({content_score}) penalty: capping at 35")

    final_score = round(final_score, 2)

    breakdown["final_score"] = final_score
    breakdown["scoring_unavailable"] = False

    return final_score, False, breakdown
