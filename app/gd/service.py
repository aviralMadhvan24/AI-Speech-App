"""GD speech analysis service - runs analyze pipeline for each speech."""

import asyncio
from typing import Optional
from uuid import uuid4

from fastapi import UploadFile

from app.asr.schemas import TranscriptionResult
from app.asr.whisper_service import transcribe_audio
from app.audio.preprocessing import preprocess_audio_asset
from app.audio.schemas import AudioAsset
from app.audio.storage import save_uploaded_audio
from app.auth import User
from app.core.logging_helpers import logger, stage_log
from app.fluency.schemas import FluencyResult
from app.fluency.service import build_fluency_section
from app.pronunciation.service import assess_pronunciation
from app.schemas.pronunciation_schema import PronunciationResult


async def analyze_speech_audio(
    file: UploadFile,
    user: User,
) -> tuple[AudioAsset, TranscriptionResult, PronunciationResult, FluencyResult, str]:
    """Analyze a single speech audio - reuses existing pipeline."""
    analysis_id = str(uuid4())

    audio_asset = await save_uploaded_audio(file)

    # Everything below is synchronous and CPU/IO bound (ffmpeg, Whisper, the
    # phoneme model). This runs while a discussion is live, so calling it
    # inline blocked the event loop and stalled every other participant's
    # websocket until one speech finished analysing.
    audio_asset = await asyncio.to_thread(preprocess_audio_asset, audio_asset)

    transcription = await asyncio.to_thread(
        transcribe_audio, audio_asset.processed_path
    )
    logger.info(
        stage_log(
            "gd_asr_done",
            analysis_id,
            word_count=len(transcription.words),
        )
    )

    # Use transcript as expected text for pronunciation assessment
    expected_text = transcription.text if transcription.text else None

    pronunciation = await asyncio.to_thread(
        assess_pronunciation,
        audio_path=audio_asset.processed_path,
        expected_text=expected_text,
        transcription=transcription,
        analysis_id=analysis_id,
    )

    fluency = build_fluency_section(
        transcription=transcription,
        audio_asset=audio_asset,
    )

    return audio_asset, transcription, pronunciation, fluency, analysis_id
