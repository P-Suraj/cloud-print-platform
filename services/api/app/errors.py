from fastapi import HTTPException
from fastapi.responses import JSONResponse

class AutoPrintAPIError(HTTPException):
    def __init__(self, status_code: int, error_code: str, message: str, details: dict = None):
        super().__init__(status_code=status_code, detail=message)
        self.error_code = error_code
        self.details = details or {}

def error_response(status_code: int, error_code: str, message: str, details: dict = None) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": error_code,
            "message": message,
            "details": details or {}
        }
    )
