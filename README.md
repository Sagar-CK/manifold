# Manifold

<p align="center">
  <img src="src/assets/manifold-icon.jpg" alt="Manifold logo" width="96" height="96" />
</p>

Native desktop app for local file indexing and search using Tauri + React, Gemini embeddings, and local Qdrant.

## What it does

- Indexes selected local files from include/exclude folders.
- Supports `png`, `jpg`, `jpeg`, `pdf`, `mp3`, `wav`, `mp4`, `mov`.
- Builds embeddings with Gemini (`models/gemini-embedding-2-preview`) and extracts text/OCR via `models/gemini-3-flash-preview`.
- Stores vectors in local Qdrant and runs hybrid search:
  - direct text matches (local text index)
  - semantic vector matches (Qdrant)
- Shows image thumbnails in results when available.

## Architecture (overview)

At a simple level, the pieces work like this:

1. **React UI** — You choose folders, extensions, and run search; it talks to the backend through Tauri commands.
2. **Rust backend** — Scans files on disk, fingerprints them with hashes, and drives the indexing job (what to embed, what changed).
3. **Gemini (cloud)** — Produces embeddings and optional extracted text/OCR from supported file types. The app does not run local ML models for that step.
4. **Qdrant (local)** — Stores vectors in **two collections**: one for **file content** semantics and one for **metadata** (paths/names-style signals). Search blends these with the text index below.
5. **Local text index** — Keeps normalized text for **keyword / substring-style** matches so results can mix “exact text hit” with “semantically similar.”

**Where Qdrant runs:** In **development**, you typically use **Docker** (`pnpm qdrant:up`) so the DB is easy to reset and inspect. In **production / packaged installs**, the app can **start a bundled Qdrant binary** when `MANIFOLD_QDRANT_URL` is unset, or you can still point at any external Qdrant with that env var.

## Stack

- Frontend: React 19 + TypeScript + Vite + React Router.
- Desktop shell: Tauri v2 (Rust backend + JS frontend).
- Vector DB: Qdrant (Docker in local dev; bundled binary in packaged releases).
- Styling/UI: Tailwind CSS v4 + shadcn-style components.

## Contributor setup (fresh clone)

### 1) Install dependencies

```bash
pnpm install
```

### 2) Bootstrap env + PDFium (local dev)

```bash
pnpm setup:dev
```

This will:

- create `.env.local` from `.env.example` (if missing)
- download and verify the pinned **PDFium** library for your platform into `src-tauri/resources/pdfium/`

PDF thumbnails load this native library at runtime. Qdrant is **not** downloaded here; local dev uses **Docker** (next step).

### 3) Start Qdrant (Docker)

The default `.env.example` points `MANIFOLD_QDRANT_URL` at `http://127.0.0.1:6333`. Start a matching Qdrant container (version pinned in `docker-compose.yml`, aligned with `scripts/binaries-manifest.json`):

```bash
pnpm qdrant:up
```

**Qdrant Web UI (dev):** Qdrant includes a browser **dashboard** (collections, console, tutorials) on the same HTTP port as the REST API. For local Docker dev, open:

- **[http://127.0.0.1:6333/dashboard](http://127.0.0.1:6333/dashboard)** — recommended baseline URL.
- On **macOS**, prefer **`127.0.0.1`** over **`localhost`** if the UI and `curl` ever disagree: two different processes can bind **IPv4** vs **IPv6** loopback on the same port, which looks like “empty collections in the UI” while `GET /collections` on the other address still works.

Manifold creates collections named `manifold_files_content_v2` and `manifold_files_metadata_v2` (see `src-tauri/src/qdrant.rs`).

### 4) Configure Gemini in `.env.local`

Required:

- `MANIFOLD_GEMINI_API_KEY=...` (or `GOOGLE_GENERATIVE_AI_API_KEY=...`)

Optional:

- `MANIFOLD_QDRANT_GRPC_URL=...` (only if you must override gRPC; often inferred from HTTP port)
- `MANIFOLD_QDRANT_API_KEY=...` (remote/secured Qdrant)
- `MANIFOLD_LOG=info`

### 5) Run the app

```bash
pnpm tauri dev
```

### Dev without Docker (bundled Qdrant binary)

If you cannot use Docker, clear `MANIFOLD_QDRANT_URL` in `.env.local` and install both runtime binaries:

```bash
pnpm setup:binaries
```

The app will then auto-start the Qdrant binary from `src-tauri/resources/qdrant/` when `MANIFOLD_QDRANT_URL` is unset.

## Production builds and releases

Installers must embed **PDFium and Qdrant** under `src-tauri/resources/` (Tauri bundles `resources/**/`*).

**Local release build:**

```bash
pnpm install
pnpm setup:binaries
pnpm tauri build
```

Artifacts appear under `src-tauri/target/release/bundle/`.

**CI / GitHub Actions** (see `.github/workflows/`) runs `pnpm setup:binaries` before `pnpm tauri build` so each platform packages the correct native binaries.

### Packaged app behavior

- Includes platform PDFium and Qdrant from `src-tauri/resources/`.
- On startup, the backend starts the **bundled** Qdrant process when `MANIFOLD_QDRANT_URL` is **not** set (typical for end users).
- Advanced users can still point at an external Qdrant with `MANIFOLD_QDRANT_URL`.

## Project layout

- `src/` React UI (search + settings + local config).
- `src-tauri/src/lib.rs` Tauri command surface and app wiring.
- `src-tauri/src/embedding.rs` embedding job pipeline and Gemini calls.
- `src-tauri/src/qdrant.rs` Qdrant connection, upsert, search, delete.
- `src-tauri/src/text_index.rs` Local text index for exact word matching.
- `scripts/setup-dev.mjs` contributor bootstrap (PDFium + `.env.local`).
- `scripts/setup-binaries.mjs` pinned binary downloader (`--pdfium-only`, `--qdrant-only`, or full install).
- `scripts/binaries-manifest.json` cross-platform binary versions and URLs.
- `docker-compose.yml` local Qdrant for development.

## Notes

- `.env.local` is loaded by the Rust backend; do not commit it.
- Deleting vectors only clears index data, not files on disk.
- See `docs/runtime-binaries.md` for binary source/licensing/update process.

