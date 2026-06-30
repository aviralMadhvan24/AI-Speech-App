from app.audio.preprocessing import preprocess_audio_asset
from app.audio.schemas import AudioAsset


def preprocess_audio(input_path: str):
    audio_asset = AudioAsset(
        audio_id="legacy",
        original_path=input_path
    )

    processed_audio = preprocess_audio_asset(
        audio_asset
    )

    return processed_audio.processed_path
