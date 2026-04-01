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
- Vector DB: Qdrant (Docker in local dev).
- Styling/UI: Tailwind CSS v4 + shadcn-style components.

## Run locally

### 1) Install dependencies

```bash
pnpm install
```

### 2) Create `.env.local`

Required:

- `MANIFOLD_QDRANT_URL=http://127.0.0.1:6333`
- `MANIFOLD_GEMINI_API_KEY=...` (or `GOOGLE_GENERATIVE_AI_API_KEY=...`)

Optional:

- `MANIFOLD_LOG=info`

### 3) Start Qdrant

```bash
./scripts/qdrant-dev.sh up
```

### 4) Start the app

```bash
pnpm tauri dev
```

## Project layout

- `src/` React UI (search + settings + local config).
- `src-tauri/src/lib.rs` Tauri command surface and app wiring.
- `src-tauri/src/embedding.rs` embedding job pipeline and Gemini calls.
- `src-tauri/src/qdrant.rs` Qdrant connection, upsert, search, delete.
- `scripts/qdrant-dev.sh` local Qdrant lifecycle helper.

## Notes

- `.env.local` is loaded by the Rust backend; do not commit it.
- Deleting vectors only clears index data, not files on disk.
