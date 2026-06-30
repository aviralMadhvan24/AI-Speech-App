import os
import subprocess

import soundfile
from fastapi import HTTPException

from app.audio.schemas import AudioAsset
from app.core.exceptions import AudioProcessingException
from app.core.logger import logger
from app.utils.ffmpeg_utils import get_ffmpeg_command


TARGET_SAMPLE_RATE = 16000

TARGET_CHANNELS = 1

MAX_DURATION_SECONDS = 300


def _read_audio_metadata(audio_path: str):
    info = soundfile.info(audio_path)

    duration_seconds = None

    if info.samplerate:
        duration_seconds = round(
            info.frames / info.samplerate,
            3
        )

    return {
        "duration_seconds": duration_seconds,
        "sample_rate": info.samplerate,
        "channels": info.channels,
        "format": info.format
    }


def _copy_audio_asset(audio: AudioAsset, update: dict):
    if hasattr(audio, "model_copy"):
        return audio.model_copy(update=update)

    return audio.copy(update=update)


def preprocess_audio_asset(audio: AudioAsset):
    input_base_name = os.path.splitext(
        os.path.basename(audio.original_path)
    )[0]

    output_filename = f"processed_{input_base_name}.wav"
    output_path = os.path.join("temp", output_filename)

    command = [
        get_ffmpeg_command(),
        "-y",
        "-i",
        audio.original_path,
        "-ar",
        str(TARGET_SAMPLE_RATE),
        "-ac",
        str(TARGET_CHANNELS),
        "-af",
        "loudnorm",
        output_path
    ]

    try:
        logger.info(f"Processing audio: {audio.original_path}")

        subprocess.run(
            command,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )

        metadata = _read_audio_metadata(output_path)

        duration_seconds = metadata["duration_seconds"]

        if (
            duration_seconds is not None
            and duration_seconds > MAX_DURATION_SECONDS
        ):
            raise HTTPException(
                status_code=413,
                detail="Audio duration is too long"
            )

        logger.info(f"Processed audio saved: {output_path}")

        return _copy_audio_asset(
            audio,
            {
                "processed_path": output_path,
                **metadata
            }
        )

    except FileNotFoundError:
        logger.error("ffmpeg executable not found")
        raise AudioProcessingException(
            detail="ffmpeg executable not found"
        )

    except subprocess.CalledProcessError as error:
        logger.error(error.stderr.decode())
        raise AudioProcessingException()

    except RuntimeError as error:
        logger.error(f"Unable to read processed audio metadata: {error}")
        raise AudioProcessingException(
            detail="Unable to read processed audio metadata"
        )
