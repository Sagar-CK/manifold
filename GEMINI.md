# Manifold - Gemini Context & Instructions

Manifold is a native desktop application for local file indexing and semantic search. It leverages Google Gemini for generating embeddings and local Qdrant for vector storage, providing a powerful hybrid search (text + semantic) experience for local files.

## Project Overview

- **Core Tech Stack:**
  - **Frontend:** React 19, TypeScript, Vite, React Router (HashRouter).
  - **Backend (Tauri Shell):** Rust (Tauri v2).
  - **Vector Database:** Qdrant (bundled local binary, auto-started as a sidecar).
  - **Embeddings:** Google Gemini (`models/gemini-embedding-2-preview`).
  - **Styling:** Tailwind CSS v4 + shadcn-style components.
  - **PDF Support:** PDFium for high-quality PDF thumbnail rendering.

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
  - `resources/`: Directory for bundled binaries (Qdrant, PDFium).
- `scripts/`: Development and build automation scripts.
  - `setup-dev.mjs`: One-command bootstrap for contributors.
  - `setup-binaries.mjs`: Downloads platform-specific binaries.

## Building and Running

### Prerequisites
- [pnpm](https://pnpm.io/)
- Rust/Cargo
- Google Gemini API Key

### Development Workflow
1.  **Install dependencies:**
    ```bash
    pnpm install
    ```
2.  **Bootstrap local binaries and environment:**
    ```bash
    pnpm setup:dev
    ```
    This creates `.env.local` and downloads Qdrant/PDFium binaries to `src-tauri/resources/`.
3.  **Configure API Key:**
    Add your key to `.env.local`:
    ```env
    MANIFOLD_GEMINI_API_KEY=your_api_key_here
    ```
4.  **Run in development mode:**
    ```bash
    pnpm tauri dev
    ```

### Production Build
```bash
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
