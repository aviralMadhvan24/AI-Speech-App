import aiofiles
import os

from fastapi import UploadFile

from app.utils.file_utils import generate_filename

async def save_upload_file(file: UploadFile):

    filename = generate_filename(file.filename)

    file_path = os.path.join("uploads", filename)

    async with aiofiles.open(file_path, "wb") as out_file:
        content = await file.read()
        await out_file.write(content)

    return file_path