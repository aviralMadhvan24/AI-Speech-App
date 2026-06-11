from fastapi import APIRouter
from fastapi import Form
from fastapi import HTTPException
from fastapi import UploadFile
from fastapi import File
import json
from starlette.concurrency import run_in_threadpool

from app.core.config import project_path
from app.core.logger import logger
from app.schemas.pronunciation_schema import AnalyzeResponse
from app.schemas.pronunciation_schema import WordTimestamp

from app.services.storage_service import save_upload_file
from app.services.audio_service import preprocess_audio

from app.pronunciation.mfa_service import parse_textgrid
from app.pronunciation.mfa_service import run_mfa_alignment
from app.pronunciation.phoneme_service import get_expected_word_phonemes
from app.pronunciation.whisper_service import transcribe_audio
from app.pronunciation.transcript_cleaner import normalize_transcript
from app.pronunciation.scoring_service import calculate_clarity_score
from app.pronunciation.scoring_service import calculate_pace_wpm
from app.pronunciation.scoring_service import calculate_pronunciation_score
from app.pronunciation.scoring_service import build_word_scores
from app.pronunciation.scoring_service import compare_expected_to_transcript


router = APIRouter()

PROMPTS_PATH = project_path("app/data/pronunciation_prompts.json")

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

    processed_audio_path = await run_in_threadpool(
        preprocess_audio,
        uploaded_file_path
    )

    transcription_result = await run_in_threadpool(
        transcribe_audio,
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

    expected_phonemes = []

    phoneme_timeline = []
    heard_phonemes = []
    word_scores = []
    word_phoneme_data = []

    mfa_available = False

    mfa_error = None

    if expected_text:
        word_match_score, mistakes = compare_expected_to_transcript(
            expected_text,
            transcript
        )
        pronunciation_score = word_match_score

        expected_phonemes = await run_in_threadpool(
            get_expected_word_phonemes,
            expected_text
        )

        try:
            textgrid_path = await run_in_threadpool(
                run_mfa_alignment,
                processed_audio_path,
                transcript
            )

            alignment_data = await run_in_threadpool(
                parse_textgrid,
                textgrid_path
            )
            phoneme_timeline = alignment_data.get(
                "phones",
                []
            )
            word_phoneme_data = alignment_data.get(
                "words",
                []
            )
            mfa_available = True

        except Exception as error:
            logger.warning(f"MFA alignment unavailable: {error}")

            mfa_error = str(error)

        word_scores = build_word_scores(
            expected_text,
            transcript,
            words_output,
            expected_phonemes,
            word_phoneme_data,
            mfa_available
        )

        mistake_words = {
            mistake["expected_word"]
            for mistake in mistakes
        }

        for word_score in word_scores:
            if (
                word_score["phoneme_score"] is not None
                and word_score["phoneme_score"] < 85
                and word_score["word"] not in mistake_words
            ):
                mistakes.append({
                    "expected_word": word_score["word"],
                    "heard_word": word_score["heard_word"],
                    "feedback": word_score["feedback"]
                })
                mistake_words.add(word_score["word"])

        pronunciation_score = calculate_pronunciation_score(
            word_match_score,
            word_scores
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
        mistakes=mistakes,
        expected_phonemes=expected_phonemes,
        phoneme_timeline=phoneme_timeline,
        word_scores=word_scores,
        mfa_available=mfa_available,
        mfa_error=mfa_error
    )
