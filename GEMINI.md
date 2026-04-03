# Manifold - Gemini Context & Instructions

Manifold is a native desktop application for local file indexing and semantic search. It leverages Google Gemini for generating embeddings and local Qdrant for vector storage, providing a powerful hybrid search (text + semantic) experience for local files.

## Project Overview

- **Core Tech Stack:**
  - **Frontend:** React 19, TypeScript, Vite, React Router (HashRouter).
  - **Backend (Tauri Shell):** Rust (Tauri v2).
  - **Vector Database:** Qdrant — **Docker** in local dev (default); **bundled binary** in packaged releases when `MANIFOLD_QDRANT_URL` is unset.
  - **Embeddings:** Google Gemini (`models/gemini-embedding-2-preview`).
  - **Styling:** Tailwind CSS v4 + shadcn-style components.
  - **PDF Support:** PDFium (dynamic library) via `pdfium-render` for PDF thumbnail rendering.

- **Key Features:**
  - Indexing of local files (images, PDFs, audio, video).
  - Hybrid search combining direct text matches and semantic vector matches.
  - On-demand thumbnail generation for images and PDFs.
  - Local-first architecture with optional external Qdrant support.

## Project Structure

- `src/`: React frontend source code.
  - `components/`: UI components (including `ui/` for shadcn-style primitives).
  - `pages/`: Application views (`SearchPage`, `SettingsPage`).
  - `lib/`: Frontend utilities and configuration management.
- `src-tauri/`: Rust backend source code.
  - `src/lib.rs`: Main entry point and Tauri command definitions.
  - `src/qdrant.rs`: Qdrant client and vector operations.
  - `src/embedding.rs`: Gemini embedding pipeline and job management.
  - `src/text_index.rs`: Simple local text index for direct keyword matching.
  - `resources/`: Bundled native binaries for releases (Qdrant, PDFium); dev typically uses Docker for Qdrant.
- `scripts/`: Development and build automation scripts.
  - `setup-dev.mjs`: Contributor bootstrap — PDFium + `.env.local` (see README).
  - `setup-binaries.mjs`: Downloads pinned platform binaries; supports `--pdfium-only` and `--qdrant-only`.
- `docker-compose.yml`: Local Qdrant for development (version pinned with `binaries-manifest.json`).

## Building and Running

### Prerequisites

- [pnpm](https://pnpm.io/)
- Rust/Cargo
- Google Gemini API Key
- Docker (recommended for local dev Qdrant)

### Development Workflow

1. **Install dependencies:**

   ```bash
   pnpm install
   ```

2. **Bootstrap PDFium and env:**

   ```bash
   pnpm setup:dev
   ```

   This creates `.env.local` from `.env.example` (if missing) and downloads **PDFium** to `src-tauri/resources/pdfium/`. It does **not** download the Qdrant binary by default.

3. **Start Qdrant (Docker):**

   ```bash
   pnpm qdrant:up
   ```

   `.env.example` sets `MANIFOLD_QDRANT_URL=http://127.0.0.1:6333` so the app talks to Docker instead of spawning a local binary.

4. **Configure API key:** Add your key to `.env.local`:

   ```env
   MANIFOLD_GEMINI_API_KEY=your_api_key_here
   ```

5. **Run in development mode:**

   ```bash
   pnpm tauri dev
   ```

### Production Build

Install **both** Qdrant and PDFium before building installers:

```bash
pnpm setup:binaries
pnpm tauri build
```

## Development Conventions

- **Frontend:**
  - Use React 19 primitives and functional components with hooks.
  - Styling is handled via Tailwind CSS v4.
  - Communicate with Rust via `invoke` for commands and `listen` for async events (e.g., embedding progress).
- **Backend (Rust):**
  - Keep Tauri commands thin; delegate logic to modules (`qdrant.rs`, `embedding.rs`).
  - Use `tracing` for logging.
  - Environment variables are loaded from `.env.local` via `dotenvy`.
- **Security:**
  - Never commit `.env.local` or any sensitive credentials.
  - Ensure file system access is scoped appropriately via Tauri permissions.
- **Testing:**
  - Hybrid search logic resides in `hybrid_search` (lib.rs), which coordinates between `text_index` and `qdrant`.
