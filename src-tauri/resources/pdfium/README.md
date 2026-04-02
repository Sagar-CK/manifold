This directory stores platform-specific PDFium dynamic libraries bundled by Tauri.

Expected filenames by platform:
- macOS: `libpdfium.dylib`
- Linux: `libpdfium.so`
- Windows: `pdfium.dll`

This app's thumbnail loader checks Tauri resource locations first, including:
- `<app resources>/pdfium/`
- `<app resources>/`

Default setup (recommended):
1) Run `pnpm setup:binaries` from repo root.
2) The script downloads and verifies the pinned PDFium artifact.
3) It installs the expected library file in this folder.

Manual setup (advanced/fallback):
- You can still place the platform library here yourself.
- Use this only if you intentionally skip the setup scripts.

Optional dev override:
- Set `MANIFOLD_PDFIUM_LIB_DIR` to a directory containing the platform library file.
