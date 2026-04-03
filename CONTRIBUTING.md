# Contributing to Manifold

First off, thank you for considering contributing to Manifold!

Manifold is a Tauri-based desktop application. The backend is written in Rust, and the frontend uses React, TypeScript, and Vite.

## Quick start (local development)

The default developer workflow uses **Docker for Qdrant** and a downloaded **PDFium** library for PDF thumbnails (same PDFium approach as production).

1. **Install dependencies**
  ```bash
   pnpm install
  ```
2. **Bootstrap environment + PDFium**
  ```bash
   pnpm setup:dev
  ```
   This creates `.env.local` from `.env.example` (if missing) and installs PDFium into `src-tauri/resources/pdfium/`. It does **not** download the Qdrant binary.
3. **Configure API key**
  Open `.env.local` and set your Gemini API key:
   The template sets `MANIFOLD_QDRANT_URL=http://127.0.0.1:6333` for Docker.
4. **Start Qdrant**
  ```bash
   pnpm qdrant:up
  ```
   Optional: open [http://localhost:6333/dashboard](http://localhost:6333/dashboard).
5. **Run the app**
  ```bash
   pnpm tauri dev
  ```

---

## Alternative: dev without Docker

If you prefer not to run Docker, clear `MANIFOLD_QDRANT_URL` in `.env.local` and install **both** Qdrant and PDFium:

```bash
pnpm setup:binaries
```

With an empty `MANIFOLD_QDRANT_URL`, the Rust backend will start the bundled Qdrant binary from `src-tauri/resources/qdrant/` on launch.

---

## Packaging and building

Manifold relies on Tauri's bundler for `.dmg`, `.exe`, or `.AppImage` installers.

**Before `pnpm tauri build`**, install full runtime binaries (Qdrant + PDFium):

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

