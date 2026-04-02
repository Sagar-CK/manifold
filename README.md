# Manifold

<p align="center">
  <img src="src/assets/manifold-icon.jpg" alt="Manifold logo" width="96" height="96" />
</p>

Native desktop app for local file indexing and search using Tauri + React, Gemini embeddings, and local Qdrant.

## What it does

- Indexes selected local files from include/exclude folders.
- Supports `png`, `jpg`, `jpeg`, `pdf`, `mp3`, `wav`, `mp4`, `mov`.
- Builds embeddings with Gemini (`models/gemini-embedding-2-preview`).
- Stores vectors in local Qdrant and runs hybrid search:
  - direct text matches (local text index)
  - semantic vector matches (Qdrant)
- Shows image thumbnails in results when available.

## Stack

- Frontend: React 19 + TypeScript + Vite + React Router.
- Desktop shell: Tauri v2 (Rust backend + JS frontend).
- Vector DB: Qdrant (bundled local binary by default; external URL override supported).
- Styling/UI: Tailwind CSS v4 + shadcn-style components.

## Contributor setup (fresh clone)

### 1) Install dependencies

```bash
pnpm install
```

### 2) Bootstrap local runtime binaries + env

```bash
pnpm setup:dev
```

This will:
- create `.env.local` from `.env.example` (if missing)
- download and verify pinned PDFium + Qdrant binaries for your platform
- place binaries under `src-tauri/resources/` so Tauri can use/package them

### 3) Configure Gemini key in `.env.local`

Required:

- `MANIFOLD_GEMINI_API_KEY=...` (or `GOOGLE_GENERATIVE_AI_API_KEY=...`)

Optional:

- `MANIFOLD_QDRANT_URL=...` (override bundled local Qdrant with external instance)
- `MANIFOLD_QDRANT_GRPC_URL=...` (override gRPC endpoint, defaults to inferred port 6334)
- `MANIFOLD_QDRANT_API_KEY=...` (optional API key for remote instances)
- `MANIFOLD_LOG=info`

> [!WARNING]
> **Do not set `MANIFOLD_QDRANT_URL` unless you are running an external Qdrant instance.**
> If this variable is set, the application will **not** start its bundled local Qdrant process. If the URL is incorrect or the external service is unreachable, you will see a "Qdrant is not configured or reachable" error.

### 4) Start the app

```bash
pnpm tauri dev
```

## Standalone app behavior

- Production bundles include platform PDFium and Qdrant binaries from `src-tauri/resources/`.
- On app startup, backend auto-starts a local Qdrant process unless `MANIFOLD_QDRANT_URL` is set.
- You can still point to a remote/external Qdrant by setting `MANIFOLD_QDRANT_URL`.

## Project layout

- `src/` React UI (search + settings + local config).
- `src-tauri/src/lib.rs` Tauri command surface and app wiring.
- `src-tauri/src/embedding.rs` embedding job pipeline and Gemini calls.
- `src-tauri/src/qdrant.rs` Qdrant connection, upsert, search, delete.
- `scripts/setup-dev.mjs` one-command bootstrap for contributors.
- `scripts/setup-binaries.mjs` pinned binary downloader + checksum verifier.
- `scripts/binaries-manifest.json` cross-platform binary versions and URLs.

## Notes

- `.env.local` is loaded by the Rust backend; do not commit it.
- Deleting vectors only clears index data, not files on disk.
- See `docs/runtime-binaries.md` for binary source/licensing/update process.
