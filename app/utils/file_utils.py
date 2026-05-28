import os
import uuid

def generate_filename(filename: str):
    extension = filename.split(".")[-1]
    return f"{uuid.uuid4()}.{extension}"

def ensure_directories():
    directories = [
        "uploads",
        "outputs",
        "temp"
    ]

    for directory in directories:
        os.makedirs(directory, exist_ok=True)