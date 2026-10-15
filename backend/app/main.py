from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.routers import api
from app.services.errors import UpstreamError

settings = get_settings()
app = FastAPI(title=settings.app_name, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.exception_handler(UpstreamError)
async def upstream_error_handler(_: Request, exc: UpstreamError):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


app.include_router(api.router)
