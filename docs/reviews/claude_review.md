## Recommended Architecture: AutoPrint Layout Pipeline

---

### Module Structure

```
desktop-agent/
│
├── agent.py                  # Polling loop ONLY. Claim job, route to pipeline, update status.
│
├── print_executor.py         # SumatraPDF invocation ONLY. No layout logic ever.
│
├── layout_engines/
│   ├── __init__.py           # Registry: maps layout_mode string → engine class
│   ├── base.py               # Abstract BaseLayoutEngine interface
│   ├── document.py           # Standard PDF/Word/Image → print-ready PDF
│   ├── id_card.py            # Aadhaar front+back → stitched A4 PDF
│   ├── photo_grid.py         # Multiple images → grid PDF (2x2, 3x3, etc.)
│   └── nup.py                # N-Up: many PDF pages → fewer sheets
│
└── preview/
    ├── __init__.py
    └── generator.py          # Rasterizes first page of processed PDF → JPEG thumbnail
```

---

### Responsibilities

**`agent.py`** — *Orchestrator only.*
Claims job from Supabase, downloads files, selects the correct engine via the registry, calls `engine.process()`, gets back a `ProcessedJob` result, hands it to `print_executor`, cleans up temp files, updates job status. It must not know *how* any layout works.

**`layout_engines/base.py`** — *Contract.*
Defines one method: `process(job: dict, downloaded_files: list[str]) → str` (returns path to the print-ready PDF). Every engine signs this contract. Nothing more.

**`layout_engines/__init__.py`** — *Registry.*
A dict mapping `layout_mode` strings to engine classes. Adding a new layout type means registering one new entry here. `agent.py` never changes for new layout types.

**Individual Engines** — *Isolated, single-purpose.*
Each engine owns its own imports and dependencies. `id_card.py` imports Pillow. `nup.py` imports pypdf. `document.py` imports win32com for Word conversion. If Pillow breaks, only `id_card.py` is affected.

**`print_executor.py`** — *Printer interface only.*
Accepts a path to a PDF and a settings dict. Builds the SumatraPDF command string. Executes it. Returns success/failure. It must not know anything about how that PDF was generated.

**`preview/generator.py`** — *Optional post-processing.*
After any engine produces its print-ready PDF, the preview generator renders the first page to a low-res JPEG and uploads it to Supabase Storage. The frontend polls for its existence and displays it. This is entirely optional — if it fails, the print job proceeds unaffected.

---

### Pipeline Flow

```
agent.py
  → downloads files
  → engine = Registry.get(job["layout_mode"])
  → pdf_path = engine.process(job, files)
  → preview.generate(pdf_path, job_id)    ← optional, non-blocking
  → print_executor.print_file(pdf_path, printer, settings)
  → update status
  → cleanup temp files
```

Every step is isolated. Every step can fail independently without corrupting the others.

---

### Major Architectural Risks

**1. Preview generation blocking the print job.**
If preview generation takes 3 seconds and a customer is waiting, you've introduced latency at the worst possible moment. Preview must run in a background thread or be skipped entirely if it doesn't complete quickly. The print job must never wait for the preview.

**2. Shared mutable state across engines.**
Each engine runs inside the same Python process. If any engine modifies a global (like `Image.MAX_IMAGE_PIXELS = None`), it affects all subsequent jobs. Keep engine `process()` methods stateless and self-contained.

**3. Temp file proliferation.**
As engine count grows, each engine creates different temp files. If cleanup is scattered across engines, orphaned files accumulate. The `agent.py` orchestrator — not the engines — must own the cleanup list. Engines return file paths; the orchestrator destroys them.

**4. Registry becoming a config file.**
If engine selection logic grows complex ("use nup.py if pages_per_sheet > 1 AND layout_mode is document"), that logic leaks back into `agent.py`. The registry must map strictly on `layout_mode` string alone. Engines internally handle their own settings variations.

---

### What NOT To Do

**Do not put layout logic in `agent.py`.** Not a single conditional for Aadhaar, N-up, or photos. Ever. The moment it enters the polling loop, you've lost the ability to test or extend layouts independently.

**Do not put print settings parsing in engines.** Engines transform files into printable PDFs. They must not build SumatraPDF commands or touch printer names. That belongs exclusively in `print_executor.py`.

**Do not generate previews synchronously.** Do not await a preview upload before printing. Customers waiting at the counter cannot tolerate this.

**Do not share a single "conversion utils" file.** It becomes the new `agent.py` monster. Each engine imports only what it needs.

**Do not version the pipeline in the database.** The `layout_mode` field in `print_jobs` should remain a simple string enum. Do not add `pipeline_version`, `engine_flags`, or `processor_config` columns to the database. Job parameters belong in simple, flat columns that SumatraPDF or the engines can directly consume.

---

### One Principle To Hold

> `agent.py` should read like a job description, not a job implementation.

If you ever find yourself writing `if layout_mode == "id_card":` inside the polling loop, stop. That logic belongs in an engine. The agent's job is: claim → route → print → report. Nothing more.
