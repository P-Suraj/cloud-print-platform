import psycopg2, os
with psycopg2.connect(os.environ['DATABASE_URL']) as c:
    with c.cursor() as cur:
        cur.execute('''\n            SELECT conname, pg_get_constraintdef(oid)\n            FROM pg_constraint\n            WHERE conrelid IN (\n                'autoprint_v3.shop_memberships'::regclass,\n                'autoprint_v3.users'::regclass\n            )\n        ''')
        for r in cur.fetchall():
            print(r)
