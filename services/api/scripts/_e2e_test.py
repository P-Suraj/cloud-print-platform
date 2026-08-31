import os, sys, hashlib, time, httpx

API = "https://autoprint-api.vercel.app"
SHOP = "CANARY01"
PDF = r"F:\Projects\Printer automation\frontend\public\Sample_Resume.pdf"
hdrs = {"X-AutoPrint-Contract-Version": "3"}
c = httpx.Client(base_url=API, timeout=90, headers=hdrs)

def ok(name, res):
    print(f"  [{res.status_code}] {name}", flush=True)
    if not res.is_success:
        print(f"  ERR: {res.text[:400]}", flush=True); sys.exit(1)
    return res.json()

pdf = open(PDF, "rb").read()
print(f"PDF {len(pdf)} bytes sha={hashlib.sha256(pdf).hexdigest()[:10]}", flush=True)
ok("health", c.get("/health/live"))
ok("shop", c.get(f"/api/v3/shops/{SHOP}"))
od = ok("create-order", c.post(f"/api/v3/shops/{SHOP}/orders", json={"submission_channel":"qr","fulfillment_mode":"counter"}))
oid, cap = od["order_id"], od["capability_token"]
print(f"  order={oid}", flush=True)
intent = ok("upload-intent", c.post(f"/api/v3/orders/{oid}/upload-intent", json={"original_file_name":"t.pdf","declared_media_type":"application/pdf","byte_size":len(pdf)}, headers={"X-AutoPrint-Capability":cap}))
did, url = intent["source_document_id"], intent["signed_upload_url"]
put = httpx.put(url, content=pdf, headers={"Content-Type":"application/pdf","x-upsert":"false"}, timeout=60)
print(f"  [{put.status_code}] PUT signed-url", flush=True)
if not put.is_success: print(put.text[:300]); sys.exit(1)
t = time.time()
fin = ok("finalize-upload", c.post(f"/api/v3/orders/{oid}/finalize-upload", json={"source_document_id":did}, headers={"X-AutoPrint-Capability":cap}))
elapsed = time.time()-t
print(f"  finalize done in {elapsed:.1f}s pages={fin.get('page_count')}", flush=True)
st = ok("order-status", c.get(f"/api/v3/orders/{oid}", headers={"X-AutoPrint-Capability":cap}))
ostat = st["order"]["status"]
print(f"  order.status={ostat}", flush=True)
if ostat != "ready_for_approval": print(f"FAIL got {ostat}"); sys.exit(1)
qd = ok("create-quote", c.post(f"/api/v3/orders/{oid}/quotes", json={"options":{"copies":1,"color_mode":"bw","duplex":False,"page_range":None,"orientation":"auto","fit_mode":"fit","paper_size":"A4"}}, headers={"X-AutoPrint-Capability":cap}))
qid = qd.get("quote_id"); tp = qd.get("breakdown",{}).get("total_paise","?")
print(f"  quote={qid} total={tp} paise", flush=True)
if not qid: print("FAIL no quote_id"); sys.exit(1)
print(f"\nSUCCESS {elapsed:.1f}s finalize | order={oid} | quote={qid} | {tp} paise", flush=True)