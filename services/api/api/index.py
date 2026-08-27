# Vercel serverless entrypoint for AutoPrint v3 FastAPI
from app.main import app  # noqa: F401  -- Vercel picks up 'app' as the ASGI handler