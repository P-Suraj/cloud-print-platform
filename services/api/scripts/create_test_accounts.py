"""Create 2 test shop accounts for CANARY01: one owner, one staff."""
import os, httpx, psycopg2

ACCOUNTS = [
    ("Test Owner", "owner", "testowner@autoprint.dev"),
    ("Test Staff",  "staff",  "teststaff@autoprint.dev"),
]
PASSWORD = "AutoPrint@123"

admin = httpx.Client(
    base_url=os.environ["SUPABASE_URL"].rstrip("/"),
    headers={
        "apikey": os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        "Authorization": f"Bearer {os.environ['SUPABASE_SERVICE_ROLE_KEY']}",
        "Content-Type": "application/json",
    },
    timeout=30,
)

with psycopg2.connect(os.environ["DATABASE_URL"]) as conn:
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM public.shops WHERE shop_code = 'CANARY01'")
        shop_row = cur.fetchone()
        if not shop_row:
            raise RuntimeError("CANARY01 shop not found")
        shop_id = shop_row[0]

    for display_name, role, email in ACCOUNTS:
        res = admin.post("/auth/v1/admin/users", json={
            "email": email,
            "password": PASSWORD,
            "email_confirm": True,
        })
        if res.status_code == 422 and "already" in res.text.lower():
            list_res = admin.get("/auth/v1/admin/users?per_page=1000")
            list_res.raise_for_status()
            users = list_res.json().get("users", [])
            match = next((u for u in users if u["email"] == email), None)
            if not match:
                raise RuntimeError(f"Cannot find existing user {email}")
            identity_id = match["id"]
            admin.put(f"/auth/v1/admin/users/{identity_id}", json={"password": PASSWORD}).raise_for_status()
        else:
            res.raise_for_status()
            identity_id = res.json()["id"]

        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO autoprint_v3.users (identity_provider, identity_subject, email, display_name)
                VALUES ('supabase', %s, %s, %s)
                ON CONFLICT ON CONSTRAINT users_identity_unique
                DO UPDATE SET email=EXCLUDED.email, display_name=EXCLUDED.display_name
                RETURNING id
                """,
                (identity_id, email, display_name),
            )
            user_id = cur.fetchone()[0]

            cur.execute(
                """
                INSERT INTO autoprint_v3.shop_memberships (shop_id, user_id, role, active)
                VALUES (%s, %s, %s, true)
                ON CONFLICT ON CONSTRAINT shop_memberships_unique
                DO UPDATE SET role=EXCLUDED.role, active=true
                """,
                (shop_id, user_id, role),
            )

        print(f"  EMAIL={email}")
        print(f"  ROLE={role}")
        print(f"  PASSWORD={PASSWORD}")
        print()