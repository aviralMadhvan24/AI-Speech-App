import os
import subprocess

from app.core.config import project_path
from app.core.config import settings
from app.core.logger import logger
from app.core.exceptions import AudioProcessingException
from app.utils.ffmpeg_utils import get_ffmpeg_command


def preprocess_audio(input_path: str):

    input_base_name = os.path.splitext(os.path.basename(input_path))[0]

    output_filename = f"processed_{input_base_name}.wav"
    output_path = project_path(settings.TEMP_DIR) / output_filename

    command = [
        get_ffmpeg_command(),
        "-y",
        "-i",
        input_path,
        "-ar",
        "16000",
        "-ac",
        "1",
        "-af",
        "loudnorm",
        str(output_path)
    ]

    try:
        logger.info(f"Processing audio: {input_path}")

        subprocess.run(
            command,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )

        logger.info(f"Processed audio saved: {output_path}")

        return str(output_path)

    except FileNotFoundError:
        logger.error("ffmpeg executable not found")
        raise AudioProcessingException(
            detail="ffmpeg executable not found"
        )

    except subprocess.CalledProcessError as error:
        stderr = error.stderr.decode(errors="replace")
        logger.error("ffmpeg failed: %s", stderr)
        raise AudioProcessingException() from error
