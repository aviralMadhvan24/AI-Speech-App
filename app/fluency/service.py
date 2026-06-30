from app.asr.schemas import TranscriptionResult
from app.audio.schemas import AudioAsset
from app.fluency.schemas import FluencyResult
from app.pronunciation.scoring_service import calculate_clarity_score


def build_fluency_section(
    transcription: TranscriptionResult,
    audio_asset: AudioAsset,
) -> FluencyResult:
    words = transcription.words

    if words:
        start = min(word.start for word in words)
        end = max(word.end for word in words)
        speech_duration = round(end - start, 3)
        minutes = (end - start) / 60.0
        wpm = round(len(words) / minutes, 2) if minutes > 0 else 0
    else:
        speech_duration = 0
        wpm = 0

    total_duration = (
        audio_asset.duration_seconds
        if audio_asset.duration_seconds is not None
        else 0
    )

    return FluencyResult(
        words_per_minute=wpm,
        speech_duration_seconds=speech_duration,
        total_duration_seconds=total_duration,
        silence_ratio=None,
        long_pause_count=0,
        filler_word_count=0,
        repetition_count=0,
        clarity_score=calculate_clarity_score(words),
    )
