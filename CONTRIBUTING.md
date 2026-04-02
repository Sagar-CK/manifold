# Contributing to Manifold

First off, thank you for considering contributing to Manifold! 

Manifold is a Tauri-based desktop application. The backend is written in Rust, and the frontend uses React, TypeScript, and Vite.

## 🚀 Quick Start (Standard Setup)

The standard setup perfectly mirrors the production environment of the packaged app. It downloads pre-compiled binaries for Qdrant and PDFium so you don't need Docker or external dependencies.

1. **Install Dependencies**
   ```bash
   pnpm install
   ```

2. **Bootstrap Environment**
   ```bash
   pnpm setup:dev
   ```
   *This creates your `.env.local` file and downloads the required platform binaries to `src-tauri/resources/`.*

3. **Configure API Key**
   Open `.env.local` and add your Gemini API Key:
   ```env
   MANIFOLD_GEMINI_API_KEY=your_gemini_api_key
   ```

4. **Start the App**
   ```bash
   pnpm tauri dev
   ```

---

## 🐳 Advanced Setup (Docker & Qdrant Web UI)

If you are debugging vector search, modifying collections, or want a visual dashboard, you can run Qdrant externally via Docker. This gives you access to the built-in **Qdrant Web UI**.

1. **Start Qdrant via Docker**
   ```bash
   docker compose up -d
   ```
   *You can now view the Qdrant Dashboard at [http://localhost:6333/dashboard](http://localhost:6333/dashboard).*

2. **Point Manifold to the External DB**
   Open your `.env.local` and add the `MANIFOLD_QDRANT_URL` variable. This tells the Rust backend *not* to boot the local bundled binary, and instead connect to your Docker instance. The app will automatically infer the gRPC port (`6334`) if you specify `6333`. You can optionally set `MANIFOLD_QDRANT_GRPC_URL` and `MANIFOLD_QDRANT_API_KEY` for remote secured instances.
   ```env
   MANIFOLD_GEMINI_API_KEY=your_gemini_api_key
   MANIFOLD_QDRANT_URL=http://localhost:6333
   ```

3. **Start the App**
   ```bash
   pnpm tauri dev
   ```

---

## 📦 Packaging & Building

Manifold relies on Tauri's built-in bundler to create `.dmg`, `.exe`, or `.AppImage` files.

To build the app for your current operating system:
```bash
pnpm tauri build
```
The resulting installers will be located in `src-tauri/target/release/bundle/`.

### Automated Releases
This repository uses GitHub Actions to automatically build and publish binaries. To trigger a new release:
1. Update the `version` in `package.json` and `src-tauri/tauri.conf.json`.
2. Push a new tag formatted as `vX.Y.Z` (e.g., `git tag v0.1.1 && git push origin v0.1.1`).
3. GitHub Actions will compile the app for Mac, Windows, and Linux and attach the binaries to a new GitHub Release.
