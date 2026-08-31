import os
from typing import List

CONTRACT_VERSION = 3

class Settings:
    def __init__(self):
        self.environment: str = os.getenv("ENVIRONMENT", "development").strip().lower()
        self.contract_version: int = CONTRACT_VERSION
        self.supabase_url: str = os.getenv("SUPABASE_URL", "http://localhost:54321")
        self.supabase_service_key: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "mock-service-key")
        self.supabase_anon_key: str = os.getenv("SUPABASE_ANON_KEY", "mock-anon-key")
        self.supabase_api_role_key: str = os.getenv("SUPABASE_API_ROLE_KEY", "mock-api-role-key")
        self.supabase_worker_role_key: str = os.getenv("SUPABASE_WORKER_ROLE_KEY", "mock-worker-role-key")
        self.database_url: str = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:54321/postgres")
        self.cookie_secret: str = os.getenv("COOKIE_SECRET", "default-dev-secret-change-in-prod")
        self.pickup_code_key_v1: str = os.getenv("PICKUP_CODE_KEY_V1", "default-dev-pickup-code-key-32-chars-minimum")
        self.pickup_code_key_version: int = 1
        # Phase 5 is intentionally dark-launched until its telemetry and
        # calibration gates are founder-approved. This server-side switch is
        # not a browser authorization control.
        self.queue_estimates_enabled: bool = os.getenv("QUEUE_ESTIMATES_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}
        # Short-lived founder testing switch.  It must be explicitly enabled;
        # normal deployments continue to require a verified customer identity.
        self.customer_verification_required: bool = os.getenv("CUSTOMER_VERIFICATION_REQUIRED", "true").strip().lower() in {"1", "true", "yes", "on"}
        # Pilot-only fast path.  This is deliberately opt-in and is disabled
        # by default so the full authenticated architecture remains available.
        self.pilot_fast_mode: bool = os.getenv("PILOT_FAST_MODE", "false").strip().lower() in {"1", "true", "yes", "on"}
        self.canary_owner_email: str = os.getenv("CANARY_OWNER_EMAIL", "").strip().lower()
        self.storage_bucket: str = os.getenv("STORAGE_BUCKET", "print-jobs")
        
        origins_env = os.getenv("CORS_ALLOWED_ORIGINS", "*")
        if origins_env.startswith("["):
            import json
            try:
                self.cors_origins: List[str] = json.loads(origins_env)
            except Exception:
                self.cors_origins = ["*"]
        else:
            self.cors_origins = [o.strip() for o in origins_env.split(",") if o.strip()]

    def validate_production(self):
        """Ensure required production secrets are configured."""
        if self.environment == "production":
            if self.supabase_service_key == "mock-service-key":
                raise ValueError("SUPABASE_SERVICE_ROLE_KEY is required in production")
            if self.supabase_api_role_key == "mock-api-role-key":
                raise ValueError("SUPABASE_API_ROLE_KEY is required in production")
            if self.supabase_worker_role_key == "mock-worker-role-key":
                raise ValueError("SUPABASE_WORKER_ROLE_KEY is required in production")
            if self.supabase_anon_key == "mock-anon-key":
                raise ValueError("SUPABASE_ANON_KEY is required in production")
            if self.cookie_secret == "default-dev-secret-change-in-prod":
                raise ValueError("COOKIE_SECRET is required in production")
            if self.pickup_code_key_v1 == "default-dev-pickup-code-key-32-chars-minimum" or len(self.pickup_code_key_v1) < 32:
                raise ValueError("PICKUP_CODE_KEY_V1 must be a non-default secret of at least 32 characters in production")
            if not self.supabase_url.startswith("https://"):
                raise ValueError("SUPABASE_URL must use HTTPS in production")
            if "*" in self.cors_origins:
                raise ValueError("CORS_ALLOWED_ORIGINS cannot contain '*' in production")

settings = Settings()
