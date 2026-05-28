import os
import shutil


def get_ffmpeg_command():
    ffmpeg_path = shutil.which("ffmpeg")

    if ffmpeg_path:
        return ffmpeg_path

    local_app_data = os.environ.get("LOCALAPPDATA")

    if local_app_data:
        winget_packages_dir = os.path.join(
            local_app_data,
            "Microsoft",
            "WinGet",
            "Packages"
        )

        for root, _, files in os.walk(winget_packages_dir):
            if "ffmpeg.exe" in files:
                return os.path.join(root, "ffmpeg.exe")

    return "ffmpeg"


def ensure_ffmpeg_on_path():
    ffmpeg_path = get_ffmpeg_command()
    ffmpeg_dir = os.path.dirname(ffmpeg_path)

    if ffmpeg_dir and ffmpeg_dir not in os.environ.get("PATH", ""):
        os.environ["PATH"] = f"{ffmpeg_dir}{os.pathsep}{os.environ.get('PATH', '')}"

    return ffmpeg_path
