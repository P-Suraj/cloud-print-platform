from supabase import create_client, Client
from supabase.lib.client_options import SyncClientOptions as ClientOptions
from app.settings import settings

# v3 schema client — all autoprint_v3 table and RPC calls
_supabase_client: Client = None

# Public schema client — for public.shops and other unschema'd legacy tables
_public_client: Client = None
_worker_client: Client = None


def _create_role_client(role_token: str, schema: str) -> Client:
    """Create a gateway-valid client with an anon API key and a role JWT.

    Supabase's gateway authenticates ``apikey`` using a project API key. The
    custom AutoPrint JWT belongs in ``Authorization`` so Postgres assumes the
    least-privilege role encoded by that token.
    """
    if settings.supabase_service_key.startswith("sb_secret_"):
        # New Supabase opaque secret keys are verified by the API gateway and
        # cannot be combined with an independently signed custom role JWT.
        # Keep the secret exclusively in this trusted server process; route
        # authorization, capabilities and fenced RPCs remain the enforcement
        # boundary until project-issued custom role JWTs are available.
        return create_client(
            settings.supabase_url,
            settings.supabase_service_key,
            options=ClientOptions(schema=schema, persist_session=False),
        )

    return create_client(
        settings.supabase_url,
        settings.supabase_anon_key,
        options=ClientOptions(
            schema=schema,
            persist_session=False,
            headers={"Authorization": f"Bearer {role_token}"},
        ),
    )


def get_supabase_client() -> Client:
    """
    Return a Supabase client whose PostgREST search path defaults to
    autoprint_v3.  All table/rpc calls via this client target autoprint_v3
    unless a fully-qualified name is used.
    """
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = _create_role_client(
            settings.supabase_api_role_key, "autoprint_v3"
        )
    return _supabase_client


def get_public_supabase_client() -> Client:
    """
    Return a Supabase client targeting the public schema.
    Use only for legacy public.* tables (e.g. public.shops).
    """
    global _public_client
    if _public_client is None:
        _public_client = _create_role_client(
            settings.supabase_api_role_key, "public"
        )
    return _public_client


def get_worker_supabase_client() -> Client:
    """Return the least-privilege worker client for preparation and cleanup."""
    global _worker_client
    if _worker_client is None:
        _worker_client = _create_role_client(
            settings.supabase_worker_role_key, "autoprint_v3"
        )
    return _worker_client


def create_auth_client() -> Client:
    """Create an isolated Auth client; login must never mutate a shared data client."""
    return create_client(
        settings.supabase_url,
        settings.supabase_anon_key,
        options=ClientOptions(
            schema="public",
            persist_session=False,
            auto_refresh_token=False,
        ),
    )


def check_db_health() -> bool:
    """Readiness check: verify both the v3 schema and public shop registry."""
    try:
        get_supabase_client().table("orders").select("id").limit(1).execute()
        get_public_supabase_client().table("shops").select("id").limit(1).execute()
        return True
    except Exception:
        return False
