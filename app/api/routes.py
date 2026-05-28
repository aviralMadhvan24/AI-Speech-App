from fastapi import APIRouter
from fastapi import Form
from fastapi import HTTPException
from fastapi import UploadFile
from fastapi import File
import json
from pathlib import Path

from app.schemas.pronunciation_schema import AnalyzeResponse
from app.schemas.pronunciation_schema import WordTimestamp

from app.services.storage_service import save_upload_file
from app.services.audio_service import preprocess_audio

from app.pronunciation.whisper_service import transcribe_audio
from app.pronunciation.transcript_cleaner import normalize_transcript
from app.pronunciation.scoring_service import calculate_clarity_score
from app.pronunciation.scoring_service import calculate_pace_wpm
from app.pronunciation.scoring_service import compare_expected_to_transcript

router = APIRouter()

PROMPTS_PATH = Path("app/data/pronunciation_prompts.json")

SUPPORTED_FORMATS = [
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/x-m4a",
    "audio/webm",
    "audio/ogg"
]


@router.get("/")
async def home():

    return {
        "status": "running",
        "service": "speech-platform"
    }


@router.get("/battle/prompts")
async def get_battle_prompts():

    with open(PROMPTS_PATH, "r", encoding="utf-8") as prompts_file:
        return json.load(prompts_file)


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_audio(
    file: UploadFile = File(...),
    expected_text: str | None = Form(None)
):

    if file.content_type not in SUPPORTED_FORMATS:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported audio format: {file.content_type}"
        )

    uploaded_file_path = await save_upload_file(file)

    processed_audio_path = preprocess_audio(uploaded_file_path)

    transcription_result = transcribe_audio(
        processed_audio_path
    )

    transcript = normalize_transcript(
        transcription_result["text"]
    )

    words_output = []

    segments = transcription_result.get(
        "segments",
        []
    )

    for segment in segments:

        words = segment.get("words", [])

        for word in words:

            words_output.append(
                WordTimestamp(
                    word=word.get("word", "").strip(),
                    start=word.get("start", 0),
                    end=word.get("end", 0),
                    probability=word.get(
                        "probability",
                        0
                    )
                )
            )

    clarity_score = calculate_clarity_score(words_output)

    pace_wpm = calculate_pace_wpm(words_output)

    pronunciation_score = None

    mistakes = []

    if expected_text:
        pronunciation_score, mistakes = compare_expected_to_transcript(
            expected_text,
            transcript
        )

    return AnalyzeResponse(
        transcript=transcript,
        expected_text=expected_text,
        language=transcription_result.get(
            "language",
            "en"
        ),
        processed_audio_path=processed_audio_path,
        words=words_output,
        pronunciation_score=pronunciation_score,
        clarity_score=clarity_score,
        pace_wpm=pace_wpm,
        mistakes=mistakes
    )
