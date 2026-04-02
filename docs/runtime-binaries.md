# Runtime Binaries

Manifold depends on native runtime binaries for:
- PDF rendering (`pdfium`)
- Vector storage/search service (`qdrant`)

## Source of truth

- Binary manifest: `scripts/binaries-manifest.json`
- Installer script: `scripts/setup-binaries.mjs`

The manifest pins versioned release URLs by platform:
- `darwin-arm64`
- `darwin-x64`
- `linux-x64`
- `win32-x64`

## Verification model

For each artifact, setup script:
1. Downloads the pinned archive URL.
2. Downloads the matching pinned `*.sha256` URL.
3. Verifies SHA256 before extraction.
4. Copies the expected runtime binary into `src-tauri/resources/`.

## Output locations

- PDFium: `src-tauri/resources/pdfium/`
- Qdrant: `src-tauri/resources/qdrant/`

These directories are included in Tauri bundling via `src-tauri/tauri.conf.json` (`resources/**/*`).

## Updating versions

1. Edit URLs in `scripts/binaries-manifest.json`.
2. Run `pnpm setup:binaries` on each target platform (or CI matrix).
3. Build and smoke-test `pnpm tauri build`.

## Licensing / attribution

When upgrading, verify upstream license and redistribution terms:
- Qdrant releases: https://github.com/qdrant/qdrant/releases
- PDFium binaries: https://github.com/bblanchon/pdfium-binaries/releases
