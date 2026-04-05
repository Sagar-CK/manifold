<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="Manifold logo" width="128" height="128" />
</p>

# Manifold

**Manifold** is a desktop app for indexing folders on your machine and searching them with **keyword** and **semantic** search. It runs as a **Tauri 2** shell around a **React** UI; indexing and search orchestration live in **Rust**. Embeddings and text extraction use the **Google Gemini** API. Vectors are stored in **Qdrant**; a local **full-text index** backs substring-style matches. **Hybrid search** combines both.

Everything stays local except calls to Gemini (and optional remote Qdrant).

## What you can do

- **Configure scopes** — choose include folders, exclude paths, file extensions, and optional default folder excludes (see Settings).
- **Index media** — `png`, `jpg`, `jpeg`, `pdf`, `mp3`, `wav`, `mp4`, `mov`. PDFs use bundled **PDFium**; text/OCR paths use Gemini.
- **Search** — hybrid query over the text index plus semantic search across Qdrant collections `content_embeddings` and `metadata_embeddings` (see `src-tauri/src/qdrant.rs`).
- **Browse results** — open file detail, thumbnails where supported (`thumbnail_image_base64_png` and related UI).
- **Graph view** — explore embeddings in a 2D projection (`/graph`).
- **Tags** — organize with tags; use review flows and Gemini-assisted tagging where enabled.

Routes (hash router for the packaged app): `/` search, `/file` result, `/graph`, `/settings`, `/review-tags`.

## Stack

| Layer | Technologies |
| ----- | ------------ |
| Desktop | Tauri 2, Rust |
| UI | React 19, Vite 7, Tailwind CSS 4, shadcn/Radix, `lucide-react`, React Router |
| Vectors | Qdrant (HTTP/gRPC; v1.17.x in Docker and bundled binary manifest) |
| Models | `models/gemini-embedding-2-preview` (embeddings), `models/gemini-3-flash-preview` (text/OCR) — `src-tauri/src/embedding.rs` |

## Prerequisites

- **Node** 22+ and **pnpm** (CI uses pnpm 10)
- **Rust** stable (for `pnpm tauri dev` / `pnpm tauri build`)
- **Docker** (optional but convenient for Qdrant during development)

## Quick start

1. **Install dependencies**

   ```bash
   pnpm install
   ```

2. **Bootstrap dev resources** — creates `.env.local` from `.env.example` when missing and downloads **PDFium** into `src-tauri/resources/pdfium/`.

   ```bash
   pnpm setup:dev
   ```

3. **Qdrant**

   - **With Docker (typical dev):** default HTTP URL is `http://127.0.0.1:6333`. Start the stack:

     ```bash
     pnpm qdrant:up
     ```

     Dashboard: [http://127.0.0.1:6333/dashboard](http://127.0.0.1:6333/dashboard). On macOS, prefer `127.0.0.1` over `localhost` if the UI and API disagree (IPv4 vs IPv6).

   - **Without Docker:** clear `MANIFOLD_QDRANT_URL` in `.env.local`, run `pnpm setup:binaries`, then start the app — the bundled Qdrant binary under `src-tauri/resources/qdrant/` can be launched automatically when no external URL is set (see `.env.example` comments).

4. **Gemini API key** — set in `.env.local`:

   - `MANIFOLD_GEMINI_API_KEY` (primary), or  
   - `GOOGLE_GENERATIVE_AI_API_KEY` (fallback name the backend accepts)

5. **Run the app**

   ```bash
   pnpm tauri dev
   ```

Do not commit `.env.local`.

## Scripts

| Command | Purpose |
| ------- | ------- |
| `pnpm dev` | Vite dev server only (Tauri runs this via `beforeDevCommand`) |
| `pnpm build` | Production frontend build (`tsc` + Vite) |
| `pnpm tauri dev` / `pnpm tauri build` | Desktop app |
| `pnpm setup:dev` | `.env.local` + PDFium |
| `pnpm setup:binaries` | PDFium + Qdrant binaries (release / CI) |
| `pnpm setup:pdfium` / `pnpm setup:qdrant-binary` | Single-artifact setup |
| `pnpm qdrant:up` / `pnpm qdrant:down` | Docker Compose Qdrant |

`docker-compose.yml` pins the Qdrant image version; keep it aligned with `scripts/binaries-manifest.json`.

## Environment variables

See `.env.example` for the full list. Highlights:

- **`MANIFOLD_QDRANT_URL`** — HTTP API base (unset in packaged builds to allow bundled Qdrant).
- **`MANIFOLD_QDRANT_GRPC_URL`** — optional gRPC override.
- **`MANIFOLD_QDRANT_API_KEY`** — for secured or remote Qdrant.

### `MANIFOLD_LOG` (Rust / Tauri)

Backend logging uses [`tracing`](https://docs.rs/tracing) (`init_logging()` in `src-tauri/src/lib.rs`). Only **`MANIFOLD_LOG`** is read (not `RUST_LOG`).

- **Unset or empty** — default: **error** only (all crates).
- **Exactly one of** `error`, `warn`, `info`, `debug`, `trace` (lowercase) — dependencies stay at **error**; logs under the `manifold::…` target prefix use the chosen level.

Any other value is invalid and falls back to the same default as unset.

```bash
MANIFOLD_LOG=info pnpm tauri dev
```

## Release build

```bash
pnpm install
pnpm setup:binaries
pnpm tauri build
```

Artifacts: `src-tauri/target/release/bundle/`. GitHub Actions (`.github/workflows/tauri-build.yml`) runs `pnpm setup:binaries` before `pnpm tauri build` on macOS, Ubuntu, and Windows.

## Repository layout

| Path | Role |
| ---- | ---- |
| `src/` | React UI, routes, components |
| `src-tauri/src/lib.rs` | Tauri commands, app wiring |
| `src-tauri/src/embedding.rs` | Indexing pipeline, Gemini embed + text extraction |
| `src-tauri/src/qdrant.rs` | Qdrant client, collections, search helpers |
| `src-tauri/src/text_index.rs` | Local full-text index |
| `src-tauri/resources/` | Bundled PDFium/Qdrant (populated by setup scripts) |
| `scripts/setup-dev.mjs` | Dev bootstrap |
| `scripts/setup-binaries.mjs` | Pinned binary download + checksums |
| `scripts/binaries-manifest.json` | Version and URL manifest |
| `docs/runtime-binaries.md` | Binary sources, verification, licensing notes |

## Notes

- Clearing the index removes **vectors and index data**, not files on disk.
- Binary provenance and licensing: **`docs/runtime-binaries.md`**.
