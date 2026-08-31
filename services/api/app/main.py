from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.settings import settings
from app.db import check_db_health
from app.storage import check_storage_health
from app.routes.auth import router as auth_router
from app.routes.devices import router as devices_router
from app.routes.orders import router as orders_router
from app.routes.uploads import router as uploads_router
from app.routes.quotes import router as quotes_router
from app.routes.customer_jobs import router as customer_jobs_router
from app.routes.shop_jobs import router as shop_jobs_router
from app.routes.agent import router as agent_router
from app.routes.shops import router as shops_router
from app.routes.customer_auth import router as customer_auth_router
from app.routes.remote_policy import router as remote_policy_router
from app.routes.cancellations import router as cancellations_router
from app.routes.customer_orders import router as customer_orders_router
from app.routes.customer_pickups import router as customer_pickups_router
from app.routes.shop_pickups import router as shop_pickups_router
from app.routes.pickup_policy import router as pickup_policy_router
from app.routes.discovery import router as discovery_router
from app.routes.estimates import router as estimates_router

app = FastAPI(
    title="AutoPrint v3 Backend API",
    version="3.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

@app.on_event("startup")
async def on_startup():
    """Validate production configuration on boot."""
    settings.validate_production()

app.include_router(auth_router)
app.include_router(devices_router)
app.include_router(orders_router)
app.include_router(uploads_router)
app.include_router(quotes_router)
app.include_router(customer_jobs_router)
app.include_router(shop_jobs_router)
app.include_router(agent_router)
app.include_router(shops_router)
app.include_router(customer_auth_router)
app.include_router(remote_policy_router)
app.include_router(cancellations_router)
app.include_router(customer_orders_router)
app.include_router(customer_pickups_router)
app.include_router(shop_pickups_router)
app.include_router(pickup_policy_router)
app.include_router(discovery_router)
app.include_router(estimates_router)

# CORS Setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Contract Version Middleware
@app.middleware("http")
async def contract_version_middleware(request: Request, call_next):
    # Exempt health endpoints
    if request.url.path in ["/health/live", "/health/ready", "/docs", "/redoc", "/openapi.json"]:
        return await call_next(request)

    version_header = request.headers.get("X-AutoPrint-Contract-Version")
    if version_header and version_header != str(settings.contract_version):
        return JSONResponse(
            status_code=426,
            content={
                "error": "update_required",
                "message": f"Contract version mismatch. Expected {settings.contract_version}, got {version_header}"
            }
        )

    response = await call_next(request)
    response.headers["X-AutoPrint-Contract-Version"] = str(settings.contract_version)
    return response

@app.get("/health/live")
async def health_live():
    return {
        "status": "live",
        "contract_version": settings.contract_version
    }

@app.get("/health/ready")
async def health_ready():
    db_ok = check_db_health()
    storage_ok = check_storage_health()
    
    is_ready = db_ok and storage_ok
    status_code = 200 if is_ready else 503
    
    return JSONResponse(
        status_code=status_code,
        content={
            "status": "ready" if is_ready else "not_ready",
            "database": "ok" if db_ok else "failed",
            "storage": "ok" if storage_ok else "failed"
        }
    )
