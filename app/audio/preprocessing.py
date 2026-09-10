import os
import subprocess

import soundfile
from fastapi import HTTPException

from app.audio.schemas import AudioAsset
from app.core.exceptions import AudioProcessingException
from app.core.exceptions import InvalidAudioUploadException
from app.core.logger import logger
from app.utils.ffmpeg_utils import get_ffmpeg_command


TARGET_SAMPLE_RATE = 16000

TARGET_CHANNELS = 1

MAX_DURATION_SECONDS = 300

# Substrings ffmpeg prints when it cannot demux/decode the *input* file.
# These mean the browser handed us a broken container (truncated blob, missing
# EBML/moov header, zero streams) — retrying the same bytes cannot help, so the
# student is asked to record again instead of the request 500-ing.
UNDECODABLE_INPUT_MARKERS = (
    "ebml header parsing failed",
    "invalid data found when processing input",
    "moov atom not found",
    "does not contain any stream",
    "could not find codec parameters",
    "end of file",
    "format not recognised",
    "format not recognized",
    "invalid stream specifier",
)


def _is_undecodable_input(stderr_text: str):
    lowered = stderr_text.lower()

    return any(
        marker in lowered
        for marker in UNDECODABLE_INPUT_MARKERS
    )


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

        # ffmpeg can exit 0 having written a header-only wav — a recording
        # where the mic was muted or the blob carried no audio track. There is
        # nothing to transcribe, so treat it like any other unusable upload.
        if not duration_seconds:
            logger.warning(
                f"Empty audio after preprocessing: {audio.original_path}"
            )

            raise InvalidAudioUploadException(
                detail=(
                    "No sound was captured in that recording. "
                    "Check your microphone and record again."
                )
            )

        if duration_seconds > MAX_DURATION_SECONDS:
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
        stderr_text = (error.stderr or b"").decode(errors="replace")

        if _is_undecodable_input(stderr_text):
            # Log at WARNING, not ERROR: a broken upload is an expected event
            # under real classroom conditions, not a server fault worth paging
            # on. Keep the size so a spike in these is traceable to a device.
            logger.warning(
                f"Undecodable upload {audio.original_path} "
                f"({audio.size_bytes} bytes): "
                f"{stderr_text.strip().splitlines()[-1] if stderr_text.strip() else 'no stderr'}"
            )

            raise InvalidAudioUploadException()

        logger.error(stderr_text)
        raise AudioProcessingException()

    except RuntimeError as error:
        logger.error(f"Unable to read processed audio metadata: {error}")
        raise AudioProcessingException(
            detail="Unable to read processed audio metadata"
        )
