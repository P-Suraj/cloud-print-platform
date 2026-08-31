"""Create a persistent CANARY01 demo owner for manual UI testing."""

import os
import secrets
import uuid

import httpx
import psycopg2


email = f"autoprint-demo-{uuid.uuid4().hex[:8]}@example.com"
password = f"Demo!{secrets.token_urlsafe(12)}"

admin = httpx.Client(
    base_url=os.environ["SUPABASE_URL"].rstrip("/"),
    headers={
        "apikey": os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        "Authorization": f"Bearer {os.environ['SUPABASE_SERVICE_ROLE_KEY']}",
        "Content-Type": "application/json",
    },
    timeout=30,
)
response = admin.post(
    "/auth/v1/admin/users",
    json={"email": email, "password": password, "email_confirm": True},
)
response.raise_for_status()
identity_id = response.json()["id"]

with psycopg2.connect(os.environ["DATABASE_URL"]) as connection:
    with connection.cursor() as cursor:
        cursor.execute("SELECT id FROM public.shops WHERE shop_code = 'CANARY01'")
        shop = cursor.fetchone()
        if not shop:
            raise RuntimeError("CANARY01 does not exist")
        cursor.execute(
            """
            INSERT INTO autoprint_v3.users
              (identity_provider, identity_subject, email, display_name)
            VALUES ('supabase', %s, %s, 'AutoPrint Demo Owner')
            RETURNING id
            """,
            (identity_id, email),
        )
        user_id = cursor.fetchone()[0]
        cursor.execute(
            """
            INSERT INTO autoprint_v3.shop_memberships
              (shop_id, user_id, role, active)
            VALUES (%s, %s, 'owner', true)
            """,
            (shop[0], user_id),
        )

print(f"EMAIL={email}")
print(f"PASSWORD={password}")
