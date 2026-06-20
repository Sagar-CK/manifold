# Contributing to Manifold

First off, thank you for considering contributing to Manifold!

Manifold is an **Electron** desktop app: the **main process** is TypeScript under `electron/` (indexing, embeddings via Gemini, Qdrant, thumbnails, IPC). The **renderer** is React + TypeScript under `src/`. Shared config lives in `config/`; docs and screenshots in `docs/`.

## Quick start (local development)

Local dev uses **Docker for Qdrant** and downloaded **PDFium** + **FFmpeg** under `resources/`. No `.env` file is required.

1. **Install dependencies**
   ```bash
   pnpm install
   ```
2. **Bootstrap PDFium + FFmpeg**
   ```bash
   pnpm setup:dev
   ```
3. **Start Qdrant (Docker)**
   ```bash
   pnpm qdrant:up
   ```
   Optional: open [http://127.0.0.1:6333/dashboard](http://127.0.0.1:6333/dashboard).
4. **Run the app**
   ```bash
   pnpm dev
   ```
   On **macOS**, `pnpm dev` caches a renamed **`Manifold.app`** (not `Electron.app`) and patches the local `electron` binary path so the **Dock and menu bar** show **Manifold** during development.

   After the app opens, add your **Gemini API key** under **Settings → General**. The onboarding dialog also guides Qdrant, Gemini, and folder setup.

## Local verification

Use the fast local checks before opening a PR:

```bash
pnpm check
```

That runs Biome and TypeScript (`tsc --noEmit`).

---

## Packaging and building

Installers are produced with **electron-builder** (`pnpm dist`).

**Before `pnpm dist`**, install full runtime binaries (Qdrant + PDFium + FFmpeg):

```bash
pnpm setup:binaries
pnpm dist
```

Packaged builds bundle Qdrant and start it automatically — Docker is not required for end users.

Artifacts are written to the `release/` directory (see `package.json` → `build.directories.output`).

### Automated releases

This repository uses GitHub Actions to build and publish. To trigger a release:

1. Update the `version` in `package.json`.
2. Push a tag such as `v0.1.1` (`git tag v0.1.1 && git push origin v0.1.1`).
3. Workflows run `pnpm setup:binaries` then `pnpm dist` for macOS, Linux, and Windows.

For more on pinned binaries and paths, see [docs/runtime-binaries.md](docs/runtime-binaries.md).
