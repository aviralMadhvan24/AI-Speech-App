import anyio

from fastapi import UploadFile

from app.core.config import project_path
from app.core.config import settings
from app.utils.file_utils import generate_filename


CHUNK_SIZE = 1024 * 1024


async def save_upload_file(file: UploadFile):

    filename = generate_filename(file.filename)

    file_path = project_path(settings.UPLOAD_DIR) / filename

    async with await anyio.open_file(file_path, "wb") as out_file:
        while content := await file.read(CHUNK_SIZE):
            await out_file.write(content)

    return str(file_path)
