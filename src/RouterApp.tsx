import "./App.css";
import { useMemo, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useMutation } from "convex/react";

import { api } from "../convex/_generated/api";
import { loadConfig, type LocalConfig, type SupportedExt } from "./lib/localConfig";
import { cachedEmbedding, embedInlineData, OUTPUT_DIM } from "./lib/geminiEmbeddings";
import { mimeTypeForExtension } from "./lib/mime";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";

type ScannedFile = {
  path: string;
  size_bytes: number;
  mtime_ms: number;
  sha256: string;
};

export default function RouterApp() {
  const [cfg, setCfg] = useState<LocalConfig>(() => loadConfig());
  const [embedding, setEmbedding] = useState(false);
  const [embedProgress, setEmbedProgress] = useState({
    processed: 0,
    total: 0,
    status: "Ready to embed.",
  });

  const geminiApiKey =
    (import.meta.env.VITE_GOOGLE_GENERATIVE_AI_API_KEY as string | undefined) ?? "";

  const upsertMetadata = useMutation(api.files.upsertMetadata);
  const attachEmbedding = useMutation(api.files.attachEmbedding);

  const extOptions: SupportedExt[] = useMemo(
    () => ["png", "jpg", "jpeg", "pdf", "mp3", "wav", "mp4", "mov"],
    [],
  );

  async function runEmbed() {
    if (cfg.include.length === 0) {
      setEmbedProgress({ processed: 0, total: 0, status: "Add at least one include path." });
      return;
    }
    if (!geminiApiKey) {
      setEmbedProgress({
        processed: 0,
        total: 0,
        status: "Missing VITE_GOOGLE_GENERATIVE_AI_API_KEY.",
      });
      return;
    }

    setEmbedding(true);
    setEmbedProgress({ processed: 0, total: 0, status: "Scanning files..." });
    try {
      const scanned = (await invoke("scan_files", {
        args: { include: cfg.include, exclude: cfg.exclude, extensions: cfg.extensions },
      })) as ScannedFile[];

      if (scanned.length === 0) {
        setEmbedProgress({ processed: 0, total: 0, status: "No matching files found." });
        return;
      }

      setEmbedProgress({
        processed: 0,
        total: scanned.length,
        status: `Embedding ${scanned.length} file(s)...`,
      });

      for (let i = 0; i < scanned.length; i++) {
        const f = scanned[i]!;
        const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
        const mimeType = mimeTypeForExtension(ext);
        const fileId = await upsertMetadata({
          sourceId: cfg.sourceId,
          path: f.path,
          contentHash: f.sha256,
          mtimeMs: f.mtime_ms,
          sizeBytes: f.size_bytes,
          mimeType,
          ext,
        });

        const cacheKey = `emb:${cfg.sourceId}:${f.sha256}:${OUTPUT_DIM}`;
        const embedding = await cachedEmbedding(cacheKey, async () => {
          const readRes = (await invoke("read_file_base64", {
            args: { path: f.path, max_bytes: 25 * 1024 * 1024 },
          })) as { base64: string; size_bytes: number };
          return await embedInlineData(geminiApiKey, { mimeType, base64Data: readRes.base64 });
        });

        await attachEmbedding({
          sourceId: cfg.sourceId,
          fileId,
          embedding,
          dimensions: OUTPUT_DIM,
          model: "gemini-embedding-2-preview",
        });

        setEmbedProgress({
          processed: i + 1,
          total: scanned.length,
          status: "Embedding in progress...",
        });
      }

      setEmbedProgress({
        processed: scanned.length,
        total: scanned.length,
        status: "Embedding complete.",
      });
    } catch (e) {
      setEmbedProgress({
        processed: 0,
        total: 0,
        status: `Embedding error: ${String(e)}`,
      });
    } finally {
      setEmbedding(false);
    }
  }

  return (
    <main className="min-h-screen w-full bg-[#f6f7fb] text-black">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <Routes>
          <Route path="/" element={<SearchPage cfg={cfg} />} />
          <Route
            path="/settings"
            element={
              <SettingsPage
                cfg={cfg}
                setCfg={setCfg}
                embedding={embedding}
                embedProgress={embedProgress}
                runEmbed={runEmbed}
                extOptions={extOptions}
              />
            }
          />
        </Routes>
      </div>
    </main>
  );
}

