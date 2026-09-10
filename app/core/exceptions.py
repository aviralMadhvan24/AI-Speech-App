from fastapi import HTTPException


class AudioProcessingException(HTTPException):

    def __init__(
        self,
        detail="Audio processing failed"
    ):
        super().__init__(
            status_code=500,
            detail=detail
        )


class InvalidAudioUploadException(HTTPException):
    """The uploaded recording itself is unusable — not a server fault.

    MediaRecorder in the browser can hand us a container that is truncated or
    missing its header (a stopped-too-early recording, a tab backgrounded
    mid-capture, a flaky mic permission). ffmpeg then fails to demux it. That
    is a *client* problem: retrying the same bytes will never succeed, and the
    student needs to record again. Returning 400 rather than 500 keeps these
    out of the server-error logs and lets the UI show a "record again" prompt
    instead of a crash message.
    """

    def __init__(
        self,
        detail="That recording could not be read. Please record again."
    ):
        super().__init__(
            status_code=400,
            detail=detail
        )
