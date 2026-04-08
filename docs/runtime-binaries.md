# Runtime Binaries

Manifold depends on native runtime binaries for:

- PDF rendering (`pdfium`) — loaded dynamically by `pdfium-render` (see `src-tauri/src/lib.rs`)
- Video thumbnails (`ffmpeg`, `ffprobe`) — invoked by the Tauri thumbnail command for `mp4` / `mov`
- Vector storage/search (`qdrant`) — bundled for packaged apps; optional local binary for dev without Docker

## Source of truth

- Binary manifest: `scripts/binaries-manifest.json`
- Installer script: `scripts/setup-binaries.mjs`

The actual runtime binaries are **not committed** to this repository (they are listed in `.gitignore`). After cloning, run `pnpm setup:dev` (PDFium + FFmpeg) and/or `pnpm setup:binaries` so `src-tauri/resources/` contains the artifacts for your platform. CI runs `pnpm setup:binaries` on each matrix runner before `tauri build`.

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
3. Extracts and copies the expected file into `src-tauri/resources/`.

## Setup commands

- `pnpm setup:dev` — PDFium only (local dev; use Docker for Qdrant per README).
- `pnpm setup:binaries` — Qdrant + PDFium + FFmpeg (release builds and CI).
- `node ./scripts/setup-binaries.mjs --pdfium-only` — PDFium only.
- `node ./scripts/setup-binaries.mjs --ffmpeg-only` — FFmpeg only.
- `node ./scripts/setup-binaries.mjs --qdrant-only` — Qdrant only.

## Output locations

- PDFium: `src-tauri/resources/pdfium/`
- FFmpeg: `src-tauri/resources/ffmpeg/`
- Qdrant: `src-tauri/resources/qdrant/`

These directories are included in Tauri bundling via `src-tauri/tauri.conf.json` (`resources/**/*`).

## Updating versions

1. Edit URLs in `scripts/binaries-manifest.json`.
2. Align `docker-compose.yml` Qdrant image tag with `qdrantVersion` for local dev parity.
3. Run `pnpm setup:binaries` on each target platform (or CI matrix).
4. Build and smoke-test `pnpm tauri build`.

## Licensing / attribution

When upgrading, verify upstream license and redistribution terms:

- Qdrant releases: https://github.com/qdrant/qdrant/releases
- PDFium binaries: https://github.com/bblanchon/pdfium-binaries/releases
- FFmpeg download page: https://www.ffmpeg.org/download.html
- FFmpeg legal notes: https://ffmpeg.org/legal.html
