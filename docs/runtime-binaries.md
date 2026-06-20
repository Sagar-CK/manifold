# Runtime Binaries

Manifold depends on native runtime binaries for:

- **FFmpeg / ffprobe** — video thumbnails in the main process (`electron/thumbnails.ts`)
- **Qdrant** — vector storage and search; **Docker** for local dev (`pnpm qdrant:up`), bundled binary for packaged apps
- **PDFium** — shipped under `resources/pdfium/` via the setup script for packaging and future native PDF use; PDF text for embeddings uses `pdfjs-dist` in the main process
- **PDF page thumbnails** — the thumbnail pipeline shells out to **`pdftoppm`** (Poppler) when available on `PATH`; ensure Poppler is installed on developer machines if you need PDF previews without relying on that tool

## Source of truth

- Binary manifest: `scripts/binaries-manifest.json`
- Installer script: `scripts/setup-binaries.mjs`

The actual runtime binaries are **not committed** to this repository (they are listed in `.gitignore`). After cloning, run `pnpm setup:dev` (PDFium + FFmpeg) and/or `pnpm setup:binaries` so `resources/` contains the artifacts for your platform. CI runs `pnpm setup:binaries` on each matrix runner before `pnpm build` / `pnpm dist`.

The manifest pins versioned release URLs by platform:

- `darwin-arm64`
- `darwin-x64`
- `linux-x64`
- `win32-x64`

FFmpeg providers are pinned per macOS architecture and platform:

- macOS arm64: Martin Riedl FFmpeg Build Server (`ffmpeg` and `ffprobe` zip artifacts)
- macOS x64: Evermeet (`ffmpeg` and `ffprobe` zip artifacts)
- Linux / Windows: BtbN FFmpeg Builds (LGPL archives)

## Verification model

For each artifact, the setup script:

1. Downloads the pinned archive URL.
2. Verifies the pinned SHA256 checksum.
3. Extracts and copies the expected file into `resources/<component>/`.

## Setup commands

- `pnpm setup:dev` — PDFium + FFmpeg for local dev (Qdrant via Docker).
- `pnpm setup:binaries` — Qdrant + PDFium + FFmpeg (release builds and CI).

## Output locations

- PDFium: `resources/pdfium/`
- FFmpeg: `resources/ffmpeg/`
- Qdrant: `resources/qdrant/`

These directories are copied into the app bundle via **electron-builder** `extraResources` (`package.json` → `build.extraResources`: `from: "resources"`, `to: "resources"`). At runtime the main process resolves binaries under the repo in development and under `process.resourcesPath` when packaged.

To point at a custom FFmpeg install, set `MANIFOLD_FFMPEG_DIR` to a directory containing `ffmpeg` and `ffprobe` (normally unnecessary after `pnpm setup:dev`).

## Updating versions

1. Edit URLs in `scripts/binaries-manifest.json`.
2. Align `docker-compose.yml` Qdrant image tag with `qdrantVersion` for local dev parity.
3. Run `pnpm setup:binaries` on each target platform (or CI matrix).
4. Build and smoke-test with `pnpm dist` (or `pnpm build` for a compile-only check).

## Licensing / attribution

When upgrading, verify upstream license and redistribution terms:

- Qdrant releases: https://github.com/qdrant/qdrant/releases
- PDFium binaries: https://github.com/bblanchon/pdfium-binaries/releases
- FFmpeg download page: https://www.ffmpeg.org/download.html
- FFmpeg legal notes: https://ffmpeg.org/legal.html
