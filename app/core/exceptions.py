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