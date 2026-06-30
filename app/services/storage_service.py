from app.audio.storage import save_uploaded_audio


async def save_upload_file(file):
    audio_asset = await save_uploaded_audio(file)

    return audio_asset.original_path
