# Contributing to Manifold

First off, thank you for considering contributing to Manifold!

Manifold is a Tauri-based desktop application. The backend is written in Rust, and the frontend uses React, TypeScript, and Vite.

## Quick start (local development)

The default developer workflow uses **Docker for Qdrant** and downloaded **PDFium** + **FFmpeg** binaries for local thumbnails (same runtime-binary approach as production).

1. **Install dependencies**
  ```bash
   pnpm install
  ```
2. **Bootstrap environment + PDFium/FFmpeg**
  ```bash
   pnpm setup:dev
  ```
   This creates `.env.local` from `.env.example` (if missing) and installs PDFium into `src-tauri/resources/pdfium/` plus FFmpeg into `src-tauri/resources/ffmpeg/`. It does **not** download the Qdrant binary.
3. **Configure API key**
  Open `.env.local` and set your Gemini API key:
   The template sets `MANIFOLD_QDRANT_URL=http://127.0.0.1:6334` for Docker gRPC.
4. **Start Qdrant**
  ```bash
   pnpm qdrant:up
  ```
   Optional: open [http://127.0.0.1:6333/dashboard](http://127.0.0.1:6333/dashboard).
5. **Run the app**
  ```bash
   pnpm tauri dev
  ```

## Local verification

Use the fast local checks before opening a PR:

```bash
pnpm check
```

That runs Biome, TypeScript, Vitest, and `cargo check`.

---

## Alternative: dev without Docker

If you prefer not to run Docker, clear `MANIFOLD_QDRANT_URL` in `.env.local` and install **Qdrant, PDFium, and FFmpeg**:

```bash
pnpm setup:binaries
```

With an empty `MANIFOLD_QDRANT_URL`, the Rust backend will start the bundled Qdrant binary from `src-tauri/resources/qdrant/` on launch.

---

## Packaging and building

Manifold relies on Tauri's bundler for `.dmg`, `.exe`, or `.AppImage` installers.

**Before `pnpm tauri build`**, install full runtime binaries (Qdrant + PDFium + FFmpeg):

```bash
pnpm setup:binaries
pnpm tauri build
```

Installers are written to `src-tauri/target/release/bundle/`.

### Automated releases

This repository uses GitHub Actions to build and publish. To trigger a release:

1. Update the `version` in `package.json` and `src-tauri/tauri.conf.json`.
2. Push a tag such as `v0.1.1` (`git tag v0.1.1 && git push origin v0.1.1`).
3. Workflows run `pnpm setup:binaries` then build for macOS, Linux, and Windows.
