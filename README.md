# Manifold

<p align="center">
  <img src="src/assets/manifold-icon.png" alt="Manifold logo" width="96" height="96" />
</p>

Native desktop app for **semantic search across your local files** using **Gemini embeddings** + a **local Qdrant vector database**.

## Features

- **Local file access** (Tauri) with configurable **include/exclude** paths
- **Supported types**: `png`, `jpg/jpeg`, `pdf`, `mp3`, `wav`, `mp4`, `mov`
- **Embeddings**: Gemini `gemini-embedding-2-preview` (client-side API calls; cached locally)
- **Index + search**: vectors stored locally in **Qdrant**, searched via **vector similarity**
- **Results**: relevance score + local path + best-effort thumbnail for images

## Setup (developer)

### Prereqs

- Node + pnpm
- Rust toolchain
- Tauri prerequisites for your OS: see Tauri docs

### Install deps

```bash
pnpm install
```

### Configure env

Create `.env.local` from `.env.example` and fill:

- `VITE_GOOGLE_GENERATIVE_AI_API_KEY`
- `MANIFOLD_QDRANT_URL` (Docker Qdrant URL, e.g. `http://127.0.0.1:6333`)

### Run Qdrant via Docker (dev)

This follows the same idea as the Qdrant quickstart ([Qdrant Quickstart](https://qdrant.tech/documentation/quickstart/)).

```bash
./scripts/qdrant-dev.sh up
```

### Run the desktop app

```bash
pnpm tauri dev
```

## Notes

- **Your Gemini API key stays on-device** (the desktop app calls Gemini directly).
- Qdrant runs as a **Docker container** (see `./scripts/qdrant-dev.sh`).
- Don’t commit `.env.local`.

## Contributing

- Issues and PRs are welcome.
- Keep changes small and focused.
- Please avoid introducing new file types without adding both: (1) a MIME mapping, and (2) an embedding + size limit path.
