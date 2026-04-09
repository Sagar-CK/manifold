<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="Manifold logo" width="128" height="128" />
</p>

# Manifold

**Desktop search for your folders.** Hybrid keyword + semantic search over what you index locally. Tauri shell, React UI, and Rust for scanning/indexing/search. Gemini powers embeddings and text extraction. Qdrant stores vectors; a local index handles substring-style matches.

Only Gemini (and optional remote Qdrant) leave the machine.

## Features

- **Scopes**: include folders, excludes, extensions, defaults in Settings.
- **Media indexing**: images, PDFs (bundled PDFium), audio/video; OCR/text via Gemini when needed.
- **Search**: hybrid full-text + semantic (`content_embeddings` / `metadata_embeddings` in Qdrant; see `src-tauri/src/qdrant.rs`).
- **UI**: results with thumbnails (including bundled FFmpeg video thumbnails), a **graph** view for 2D embedding projection, plus **tags** and review flows (optional Gemini-assisted tagging).

**Routes** (hash router): `/` search · `/file` · `/graph` · `/settings` · `/review-tags`.

## Repository layout

```
manifold/
├── src/                          # React (Vite) frontend
│   ├── components/               # UI, search/, settings/, ui/ (shadcn)
│   ├── pages/                    # Search, file, graph, settings, review-tags
│   ├── lib/                      # Tags, Qdrant helpers, graph layout, config
│   ├── context/                  # Embedding status
│   ├── workers/                  # e.g. graph layout worker
│   ├── assets/
│   ├── main.tsx
│   └── RouterApp.tsx
├── src-tauri/
│   ├── src/                      # Rust: Tauri commands, app wiring
│   │   ├── lib.rs
│   │   ├── embedding.rs          # Indexing, Gemini embed + extraction
│   │   ├── qdrant.rs             # Client, collections, search
│   │   ├── scan.rs               # Shared scan pipeline + derivations
│   │   ├── text_index.rs         # Local full-text index
│   │   ├── gemini_settings.rs
│   │   ├── logging.rs
│   │   └── main.rs
│   ├── resources/                # PDFium, Qdrant binary (filled by setup scripts)
│   ├── capabilities/
│   ├── icons/
│   ├── Cargo.toml
│   └── tauri.conf.json
├── scripts/                      # setup-dev.mjs, setup-binaries.mjs, binaries-manifest.json
├── docs/
│   └── runtime-binaries.md       # Binary sources, licensing
├── public/
├── .github/workflows/            # e.g. tauri-build
├── docker-compose.yml            # Dev Qdrant (version pinned; align with manifest)
└── package.json
```

## Stack


| Layer   | Technologies                                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------- |
| Desktop | Tauri 2, Rust                                                                                                               |
| UI      | React 19, Vite 7, Tailwind CSS 4, shadcn/Radix, `lucide-react`, React Router                                                |
| Vectors | Qdrant (gRPC at `6334`; dashboard at `6333`; v1.17.x in Docker and bundled binary manifest)                               |
| Models  | `models/gemini-embedding-2-preview` (embeddings), `models/gemini-3-flash-preview` (text/OCR) — `src-tauri/src/embedding.rs` |


## Prerequisites

- **Node** 22+ and **pnpm** (CI uses pnpm 10)
- **Rust** stable (for `pnpm tauri dev` / `pnpm tauri build`)
- **Docker** (optional but convenient for Qdrant during development)

## Quick start

1. **Install dependencies**
   ```bash
   pnpm install
   ```
2. **Bootstrap dev resources**. Creates `.env.local` from `.env.example` (if missing) and downloads **PDFium** + **FFmpeg** into `src-tauri/resources/`.
   ```bash
   pnpm setup:dev
   ```
3. **Qdrant**
   - **With Docker (typical dev)**: default gRPC URL is `http://127.0.0.1:6334`. Start the stack. Dashboard: [http://127.0.0.1:6333/dashboard](http://127.0.0.1:6333/dashboard). On macOS, prefer `127.0.0.1` over `localhost` if the UI and API disagree (IPv4 vs IPv6).
   - **Without Docker**: clear `MANIFOLD_QDRANT_URL` in `.env.local`, run `pnpm setup:binaries`, then start the app. The bundled Qdrant binary under `src-tauri/resources/qdrant/` can be launched automatically when no external URL is set (see `.env.example`).
4. **Gemini API key**. Set in `.env.local`:
   - `MANIFOLD_GEMINI_API_KEY`
5. **Run the app**
   ```bash
   pnpm tauri dev
   ```

Do not commit `.env.local`.

## Scripts


| Command                                          | Purpose                                                       |
| ------------------------------------------------ | ------------------------------------------------------------- |
| `pnpm dev`                                       | Vite dev server only (Tauri runs this via `beforeDevCommand`) |
| `pnpm build`                                     | Production frontend build (`typecheck` + Vite)                |
| `pnpm typecheck`                                 | TypeScript compiler check                                     |
| `pnpm lint` / `pnpm format`                      | Biome linting and formatting                                  |
| `pnpm test` / `pnpm check`                       | Vitest unit tests / full local verification                   |
| `pnpm tauri dev` / `pnpm tauri build`            | Desktop app                                                   |
| `pnpm setup:dev`                                 | `.env.local` + PDFium + FFmpeg                                |
| `pnpm setup:binaries`                            | PDFium + FFmpeg + Qdrant binaries (release / CI)              |
| `pnpm setup:pdfium` / `pnpm setup:qdrant-binary` | Single-artifact setup                                         |
| `pnpm qdrant:up` / `pnpm qdrant:down`            | Docker Compose Qdrant                                         |


`docker-compose.yml` pins the Qdrant image version; keep it aligned with `scripts/binaries-manifest.json`.

## Environment variables

See `.env.example` for the full list. Highlights:

- **`MANIFOLD_GEMINI_API_KEY`**: Gemini embeddings/OCR API key.
- **`MANIFOLD_QDRANT_URL`**: Qdrant gRPC endpoint (default local dev: `http://127.0.0.1:6334`).
- **`MANIFOLD_QDRANT_API_KEY`**: for secured or remote Qdrant.
- **`MANIFOLD_PDFIUM_LIB_DIR`**: optional PDFium override.
- **`MANIFOLD_FFMPEG_BIN_DIR`**: optional directory override for `ffmpeg` and `ffprobe`.

### `MANIFOLD_LOG` (Rust / Tauri)

Backend logging uses `[tracing](https://docs.rs/tracing)` (`init_logging()` in `src-tauri/src/lib.rs`). Only `**MANIFOLD_LOG**` is read (not `RUST_LOG`).

- **Unset or empty**: default is **error** only (all crates).
- **Exactly one of** `error`, `warn`, `info`, `debug`, `trace` (lowercase): dependencies stay at **error**; logs under the `manifold::…` target prefix use the chosen level.

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

## Notes

- Clearing the index removes **vectors and index data**, not files on disk.
- Binary provenance and licensing: **`docs/runtime-binaries.md`**.
- Apple Silicon builds bundle native arm64 FFmpeg artifacts. `MANIFOLD_FFMPEG_BIN_DIR` still works as an override when you want to supply your own binaries.
