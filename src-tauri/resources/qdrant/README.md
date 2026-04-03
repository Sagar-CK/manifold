This directory stores platform-specific Qdrant binaries used for **packaged releases** and for **local dev without Docker**.

Do not add binaries manually. Use:

- `pnpm setup:binaries` — full install (Qdrant + PDFium), or `pnpm setup:qdrant-binary` for Qdrant only.

For day-to-day development, the repo defaults to **Docker** for Qdrant (`pnpm qdrant:up`); you do not need a file here unless you clear `MANIFOLD_QDRANT_URL` and run the commands above.

Expected output binary names:

- macOS/Linux: `qdrant`
- Windows: `qdrant.exe`
