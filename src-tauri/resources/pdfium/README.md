This directory stores platform-specific PDFium dynamic libraries bundled by Tauri.

Expected filenames by platform:
- macOS: `libpdfium.dylib`
- Linux: `libpdfium.so`
- Windows: `pdfium.dll`

This app's thumbnail loader checks Tauri resource locations first, including:
- `<app resources>/pdfium/`
- `<app resources>/`

Default setup:
1) **Local dev:** `pnpm setup:dev` (PDFium only; see repo README for Qdrant via Docker).
2) **Release / full binary install:** `pnpm setup:binaries` from repo root (Qdrant + PDFium).
3) The script downloads and verifies the pinned PDFium artifact and installs the library here.

Manual setup (advanced/fallback):
- You can still place the platform library here yourself.
- Use this only if you intentionally skip the setup scripts.

Optional dev override:
- Set `MANIFOLD_PDFIUM_LIB_DIR` to a directory containing the platform library file.
