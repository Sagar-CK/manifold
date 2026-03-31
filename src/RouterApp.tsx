import "./App.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useMutation } from "convex/react";

import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
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

type UpsertMetadataResult = {
  fileId: Id<"files">;
  shouldEmbed: boolean;
};

export default function RouterApp() {
  const [cfg, setCfg] = useState<LocalConfig>(() => loadConfig());
  const [embedding, setEmbedding] = useState(false);
  const [embedProgress, setEmbedProgress] = useState({
    processed: 0,
    total: 0,
    status: "All files embedded.",
  });
  const [hasPendingEmbeds, setHasPendingEmbeds] = useState(false);

  const geminiApiKey =
    (import.meta.env.VITE_GOOGLE_GENERATIVE_AI_API_KEY as string | undefined) ?? "";

  const upsertMetadata = useMutation(api.files.upsertMetadata);
  const attachEmbedding = useMutation(api.files.attachEmbedding);

  const extOptions: SupportedExt[] = useMemo(
    () => ["png", "jpg", "jpeg", "pdf", "mp3", "wav", "mp4", "mov"],
    [],
  );

  const autoEmbedKey = useMemo(
    () =>
      JSON.stringify({
        include: [...cfg.include].sort(),
        exclude: [...cfg.exclude].sort(),
        extensions: [...cfg.extensions].sort(),
        sourceId: cfg.sourceId,
      }),
    [cfg.exclude, cfg.extensions, cfg.include, cfg.sourceId],
  );

  const runEmbed = useCallback(async () => {
    if (cfg.include.length === 0) {
      setHasPendingEmbeds(false);
      setEmbedProgress({ processed: 0, total: 0, status: "All files embedded." });
      return;
    }
    if (!geminiApiKey) {
      setHasPendingEmbeds(false);
      setEmbedProgress({
        processed: 0,
        total: 0,
        status: "Missing VITE_GOOGLE_GENERATIVE_AI_API_KEY.",
      });
      return;
    }

    setEmbedding(true);
    setHasPendingEmbeds(true);
    setEmbedProgress({ processed: 0, total: 0, status: "Scanning files..." });
    try {
      const scanned = (await invoke("scan_files", {
        args: { include: cfg.include, exclude: cfg.exclude, extensions: cfg.extensions },
      })) as ScannedFile[];

      if (scanned.length === 0) {
        setHasPendingEmbeds(false);
        setEmbedProgress({ processed: 0, total: 0, status: "All files embedded." });
        return;
      }

      setEmbedProgress({
        processed: 0,
        total: scanned.length,
        status: "Checking for files that need embedding...",
      });

      const pending: Array<{
        fileId: Id<"files">;
        file: ScannedFile;
        mimeType: string;
      }> = [];

      for (let i = 0; i < scanned.length; i++) {
        const f = scanned[i]!;
        const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
        const mimeType = mimeTypeForExtension(ext);
        const { fileId, shouldEmbed } = (await upsertMetadata({
          sourceId: cfg.sourceId,
          path: f.path,
          contentHash: f.sha256,
          mtimeMs: f.mtime_ms,
          sizeBytes: f.size_bytes,
          mimeType,
          ext,
        })) as UpsertMetadataResult;

        if (shouldEmbed) {
          pending.push({ fileId, file: f, mimeType });
        }

        setEmbedProgress({
          processed: i + 1,
          total: scanned.length,
          status: "Checking for files that need embedding...",
        });
      }

      if (pending.length === 0) {
        setHasPendingEmbeds(false);
        setEmbedProgress({
          processed: scanned.length,
          total: scanned.length,
          status: "All files embedded.",
        });
        return;
      }

      setEmbedProgress({
        processed: 0,
        total: pending.length,
        status: `Embedding ${pending.length} file(s)...`,
      });

      for (let i = 0; i < pending.length; i++) {
        const { file, fileId, mimeType } = pending[i]!;
        const cacheKey = `emb:${cfg.sourceId}:${file.sha256}:${OUTPUT_DIM}`;
        const embedding = await cachedEmbedding(cacheKey, async () => {
          const readRes = (await invoke("read_file_base64", {
            args: { path: file.path, max_bytes: 25 * 1024 * 1024 },
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
          total: pending.length,
          status: "Embedding in progress...",
        });
      }

      setHasPendingEmbeds(false);
      setEmbedProgress({
        processed: pending.length,
        total: pending.length,
        status: "All files embedded.",
      });
    } catch (e) {
      setHasPendingEmbeds(false);
      setEmbedProgress({
        processed: 0,
        total: 0,
        status: `Embedding error: ${String(e)}`,
      });
    } finally {
      setEmbedding(false);
    }
  }, [attachEmbedding, cfg.exclude, cfg.extensions, cfg.include, cfg.sourceId, geminiApiKey, upsertMetadata]);

  useEffect(() => {
    void runEmbed();
  }, [autoEmbedKey, runEmbed]);

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
                hasPendingEmbeds={hasPendingEmbeds}
                embedProgress={embedProgress}
                extOptions={extOptions}
              />
            }
          />
        </Routes>
      </div>
    </main>
  );
}

