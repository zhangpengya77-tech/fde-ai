from starlette.responses import JSONResponse


def json_response(payload: dict, status_code: int = 200) -> JSONResponse:
    response = JSONResponse(payload, status_code=status_code)
    response.headers["Cache-Control"] = "no-store"
    return response


def error_response(code: str, message: str, status_code: int) -> JSONResponse:
    return json_response(
        {"error": {"code": code, "message": message}},
        status_code=status_code,
    )
