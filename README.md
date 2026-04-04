# Manifold

Desktop app for local file indexing and search: **Tauri + React**, **Gemini** embeddings, **Qdrant** vectors, plus a local text index for keyword matches.

## Features

- Pick include/exclude folders; index `png`, `jpg`, `jpeg`, `pdf`, `mp3`, `wav`, `mp4`, `mov`.
- Embeddings: `models/gemini-embedding-2-preview`; text/OCR: `models/gemini-3-flash-preview`.
- Hybrid search: substring/text index + semantic search over Qdrant (content + metadata collections).
- Thumbnails in results when supported.

## Quick setup

1. **Deps:** `pnpm install`
2. **Env + PDFium:** `pnpm setup:dev` — creates `.env.local` from `.env.example` if needed; downloads PDFium into `src-tauri/resources/pdfium/`.
3. **Qdrant:** Default URL is `http://127.0.0.1:6333`. Start Docker: `pnpm qdrant:up`. Dashboard: [http://127.0.0.1:6333/dashboard](http://127.0.0.1:6333/dashboard). On macOS, use `127.0.0.1` instead of `localhost` if the UI and API disagree (IPv4 vs IPv6).
4. **Gemini:** Set `MANIFOLD_GEMINI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY` in `.env.local`.
5. **Run:** `pnpm tauri dev`

**Without Docker:** unset `MANIFOLD_QDRANT_URL`, run `pnpm setup:binaries`, then `pnpm tauri dev` — the app can start the bundled Qdrant from `src-tauri/resources/qdrant/`.

Collections: `manifold_files_content_v2`, `manifold_files_metadata_v2` (see `src-tauri/src/qdrant.rs`).

## Optional env

- `MANIFOLD_QDRANT_GRPC_URL` — override gRPC if needed  
- `MANIFOLD_QDRANT_API_KEY` — secured/remote Qdrant  
- `MANIFOLD_LOG` — e.g. `info`  
- `MANIFOLD_QDRANT_URL` — external Qdrant; if unset in packaged builds, bundled Qdrant starts  

## Release build

```bash
pnpm install
pnpm setup:binaries
pnpm tauri build
```

Output: `src-tauri/target/release/bundle/`. CI runs the same binary setup before `tauri build`.

## Layout

| Path | Role |
|------|------|
| `src/` | React UI |
| `src-tauri/src/lib.rs` | Tauri commands |
| `src-tauri/src/embedding.rs` | Indexing + Gemini |
| `src-tauri/src/qdrant.rs` | Qdrant client |
| `src-tauri/src/text_index.rs` | Local text index |
| `scripts/setup-dev.mjs` | Dev bootstrap |
| `scripts/setup-binaries.mjs` | Pinned PDFium/Qdrant download |
| `scripts/binaries-manifest.json` | Versions / URLs |
| `docker-compose.yml` | Dev Qdrant |

## Notes

- Do not commit `.env.local`.
- Clearing the index removes vectors only, not files on disk.
- Binary sources and licensing: `docs/runtime-binaries.md`.
