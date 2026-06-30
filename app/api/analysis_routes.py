from uuid import uuid4

from fastapi import APIRouter
from fastapi import Depends
from fastapi import File
from fastapi import Form
from fastapi import UploadFile

from app.asr.whisper_service import transcribe_audio
from app.auth import User
from app.auth import require_user
from app.attempts.schemas import build_attempt_summary
from app.attempts.storage import save_attempt
from app.audio.preprocessing import preprocess_audio_asset
from app.audio.storage import save_uploaded_audio
from app.core.logging_helpers import logger
from app.core.logging_helpers import stage_log
from app.fluency.service import build_fluency_section
from app.pronunciation.scoring_service import compare_expected_to_transcript
from app.pronunciation.service import assess_pronunciation
from app.schemas.pronunciation_schema import AnalyzeResponse


router = APIRouter()


def build_debug_section(expected_text, transcription):
    """Build the `debug` section of the AnalyzeResponse.

    Returns a dict shaped as:
        {expected_text_provided, expected_text,
         transcript_match_score, transcript_mistakes}

    `transcript_mistakes` is the raw list of plain dicts produced by
    `compare_expected_to_transcript` — `{expected_word, heard_word, feedback}`.
    """
    if not expected_text:
        return {
            "expected_text_provided": False,
            "expected_text": None,
            "transcript_match_score": None,
            "transcript_mistakes": [],
        }

    score, mistakes = compare_expected_to_transcript(
        expected_text,
        transcription.normalized_text,
    )

    return {
        "expected_text_provided": True,
        "expected_text": expected_text,
        "transcript_match_score": score,
        "transcript_mistakes": mistakes,
    }


def unavailable_communication_section():
    """Stub section for the communication rubric (Phase 1: not configured)."""
    return {
        "available": False,
        "provider": None,
        "overall_score": None,
        "rubric_version": None,
        "message": "Communication rubric scoring is not configured yet.",
    }


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_audio(
    file: UploadFile = File(...),
    expected_text: str | None = Form(None),
    current_user: User = Depends(require_user),
):
    analysis_id = str(uuid4())

    logger.info(
        stage_log(
            "analyze_received",
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
            processed_path=audio_asset.processed_path,
            duration=audio_asset.duration_seconds,
            sample_rate=audio_asset.sample_rate,
            channels=audio_asset.channels,
        )
    )

    transcription = transcribe_audio(audio_asset.processed_path)
    logger.info(
        stage_log(
            "asr_done",
            analysis_id,
            provider=transcription.provider,
            model=transcription.model,
            word_count=len(transcription.words),
        )
    )

    pronunciation = assess_pronunciation(
        audio_path=audio_asset.processed_path,
        expected_text=expected_text,
        transcription=transcription,
        analysis_id=analysis_id,
    )
    logger.info(
        stage_log(
            "pronunciation_done",
            analysis_id,
            provider=pronunciation.provider,
            available=pronunciation.available,
            overall_score=pronunciation.overall_score,
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

    debug = build_debug_section(
        expected_text=expected_text,
        transcription=transcription,
    )

    response = AnalyzeResponse(
        analysis_id=analysis_id,
        audio=audio_asset,
        transcription=transcription,
        pronunciation=pronunciation,
        fluency=fluency,
        communication=unavailable_communication_section(),
        debug=debug,
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

    return response
