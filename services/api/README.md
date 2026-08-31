# AutoPrint v3 FastAPI Backend Service

This is the isolated FastAPI backend service for AutoPrint v3.

## Pinned Dependencies
- `fastapi==0.141.1`
- `uvicorn==0.50.1`
- `supabase==2.3.0`
- `pypdf==6.13.2`
- `psycopg2-binary==2.9.10`

## Local Development Setup

1. **Activate Virtual Environment:**
   ```powershell
   .\.venv\Scripts\Activate.ps1
   ```

2. **Run Unit Tests:**
   ```powershell
   .\.venv\Scripts\python.exe -m unittest discover -s ".\tests" -p "test_*.py" -v
   ```

3. **Configure role-isolated credentials:**

   Copy `.env.example`. `SUPABASE_API_ROLE_KEY` must carry the
   `autoprint_api_role` JWT role claim and `SUPABASE_WORKER_ROLE_KEY` must
   carry `autoprint_worker_role`. `SUPABASE_SERVICE_ROLE_KEY` is not read by
   runtime database clients.

4. **Apply and verify migrations:**

   ```powershell
   $env:DATABASE_URL = "postgresql://..."
   $env:CANARY_OWNER_EMAIL = "verified-owner@example.com"
   .\.venv\Scripts\python.exe migrations\run_migrations.py
   psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f migrations\verify_v3_schema.sql
   ```

5. **Start Development Server:**
   ```powershell
   .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
   ```

## Contract Versioning
All request headers MUST include:
```
X-AutoPrint-Contract-Version: 3
```
Health endpoints (`/health/live`, `/health/ready`) are exempt.
