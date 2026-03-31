import "./App.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";

import { loadConfig, type LocalConfig, type SupportedExt } from "./lib/localConfig";
import { cachedEmbedding, embedInlineData, OUTPUT_DIM } from "./lib/geminiEmbeddings";
import { mimeTypeForExtension } from "./lib/mime";
import { EnvIssuesBanner } from "./components/EnvIssuesBanner";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";

type ScannedFile = {
  path: string;
  size_bytes: number;
  mtime_ms: number;
  sha256: string;
};

type QdrantUpsertMetadataResult = { should_embed: boolean } | { shouldEmbed: boolean };

function normalizeExtFromPath(path: string) {
  return (path.split(".").pop() ?? "").trim().toLowerCase();
}

export default function RouterApp() {
  const [cfg, setCfg] = useState<LocalConfig>(() => loadConfig());
  const [embedding, setEmbedding] = useState(false);
  const [envIssues, setEnvIssues] = useState<string[]>([]);
  const [embedPromptDismissed, setEmbedPromptDismissed] = useState(false);
  const [embedProgress, setEmbedProgress] = useState({
    processed: 0,
    total: 0,
    status: "All files embedded.",
  });
  const [hasPendingEmbeds, setHasPendingEmbeds] = useState(false);
  const [needsEmbedding, setNeedsEmbedding] = useState(false);
  const [embedPlan, setEmbedPlan] = useState<{
    totalSelected: number | null;
    pending: number | null;
    warning: string | null;
  }>({ totalSelected: null, pending: null, warning: null });

  const geminiApiKey =
    (import.meta.env.VITE_GOOGLE_GENERATIVE_AI_API_KEY as string | undefined) ?? "";

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

  useEffect(() => {
    let cancelled = false;
    async function checkConfig() {
      const issues: string[] = [];
      if (!geminiApiKey) issues.push("Missing VITE_GOOGLE_GENERATIVE_AI_API_KEY.");
      try {
        await invoke("qdrant_status");
      } catch (e) {
        issues.push(`Qdrant is not configured or reachable: ${String(e)}`);
      }
      if (!cancelled) setEnvIssues(issues);
    }
    void checkConfig();
    return () => {
      cancelled = true;
    };
  }, [geminiApiKey]);

  const runEmbed = useCallback(async () => {
    const PROGRESS_EVERY = 25;
    const yieldToUi = async () => {
      // Let the browser paint + handle input between batches.
      await new Promise<void>((r) => window.setTimeout(r, 0));
    };
    const shouldUpdate = (i: number, total: number) => i === total || i % PROGRESS_EVERY === 0;

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

    // Preflight Qdrant once to avoid a laggy first upsert when Qdrant is down.
    try {
      await invoke("qdrant_status");
    } catch (e) {
      const msg = `Qdrant is not configured or reachable: ${String(e)}`;
      setHasPendingEmbeds(false);
      setEmbedProgress({ processed: 0, total: 0, status: msg });
      setEnvIssues((prev) => (prev.includes(msg) ? prev : [...prev, msg]));
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

      // Defensive filter: Rust already filters by cfg.extensions, but keep the
      // embedding pipeline resilient to stale cache / config edge cases.
      const selectedExts = new Set(cfg.extensions.map((e) => e.toLowerCase().replace(/^\./, "")));
      const scannedSelected = scanned.filter((f) => selectedExts.has(normalizeExtFromPath(f.path)));

      if (scannedSelected.length === 0) {
        setHasPendingEmbeds(false);
        setEmbedProgress({
          processed: 0,
          total: 0,
          status: "No selected file types found in your folders.",
        });
        return;
      }

      setEmbedProgress({
        processed: 0,
        total: scannedSelected.length,
        status: "Checking for files that need embedding...",
      });

      const pending: Array<{
        file: ScannedFile;
        mimeType: string;
      }> = [];

      for (let i = 0; i < scannedSelected.length; i++) {
        const f = scannedSelected[i]!;
        const ext = normalizeExtFromPath(f.path);
        const mimeType = mimeTypeForExtension(ext);
        // Skip anything we don't have a known mime mapping for embedding.
        if (mimeType === "application/octet-stream") {
          setEmbedProgress({
            processed: i + 1,
            total: scannedSelected.length,
            status: "Skipping unsupported file types...",
          });
          continue;
        }
        const upsertRes = (await invoke("qdrant_upsert_metadata", {
          args: { sourceId: cfg.sourceId, path: f.path, contentHash: f.sha256 },
        })) as QdrantUpsertMetadataResult;
        const shouldEmbed =
          "shouldEmbed" in upsertRes ? upsertRes.shouldEmbed : upsertRes.should_embed;

        if (shouldEmbed) {
          pending.push({ file: f, mimeType });
        }

        if (shouldUpdate(i + 1, scannedSelected.length)) {
          setEmbedProgress({
            processed: i + 1,
            total: scannedSelected.length,
            status: "Checking for files that need embedding...",
          });
          await yieldToUi();
        }
      }

      if (pending.length === 0) {
        setHasPendingEmbeds(false);
        setEmbedProgress({
          processed: scannedSelected.length,
          total: scannedSelected.length,
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
        const { file, mimeType } = pending[i]!;
        const cacheKey = `emb:${cfg.sourceId}:${file.sha256}:${OUTPUT_DIM}`;
        const embedding = await cachedEmbedding(cacheKey, async () => {
          const readRes = (await invoke("read_file_base64", {
            args: { path: file.path, max_bytes: 25 * 1024 * 1024 },
          })) as { base64: string; size_bytes: number };
          return await embedInlineData(geminiApiKey, { mimeType, base64Data: readRes.base64 });
        });

        await invoke("qdrant_upsert_embedding", {
          args: {
            sourceId: cfg.sourceId,
            path: file.path,
            contentHash: file.sha256,
            embedding,
          },
        });

        if (shouldUpdate(i + 1, pending.length)) {
          setEmbedProgress({
            processed: i + 1,
            total: pending.length,
            status: "Embedding in progress...",
          });
          await yieldToUi();
        }
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
  }, [cfg.exclude, cfg.extensions, cfg.include, cfg.sourceId, geminiApiKey]);

  useEffect(() => {
    // Don't auto-embed on startup or config changes; let the user explicitly start it.
    // But do preflight whether anything actually needs embedding to avoid showing a prompt when up-to-date.
    if (embedding) return;
    let cancelled = false;

    async function refreshNeedsEmbedding() {
      if (cfg.include.length === 0) {
        setNeedsEmbedding(false);
        setHasPendingEmbeds(false);
        setEmbedPromptDismissed(false);
        setEmbedProgress({ processed: 0, total: 0, status: "All files embedded." });
        setEmbedPlan({ totalSelected: null, pending: null, warning: null });
        return;
      }

      // If embeddings can't run, don't show the "ready" prompt.
      if (!geminiApiKey) {
        setNeedsEmbedding(false);
        setHasPendingEmbeds(false);
        setEmbedPromptDismissed(false);
        setEmbedProgress({
          processed: 0,
          total: 0,
          status: "Missing VITE_GOOGLE_GENERATIVE_AI_API_KEY.",
        });
        return;
      }

      try {
        const res = (await invoke("scan_files_needs_embedding", {
          args: {
            scan: { include: cfg.include, exclude: cfg.exclude, extensions: cfg.extensions },
            sourceId: cfg.sourceId,
          },
        })) as { totalSelected: number | string; needsEmbedding: boolean };

        const needs = Boolean(res.needsEmbedding);
        if (cancelled) return;

        setNeedsEmbedding(needs);
        setHasPendingEmbeds(needs);
        setEmbedPromptDismissed(false);
        setEmbedProgress({
          processed: 0,
          total: 0,
          status: needs ? "Ready to embed. Click Continue to start." : "All files embedded.",
        });
      } catch (e) {
        if (cancelled) return;
        // If preflight fails, fall back to showing "ready" so user can still explicitly run embedding.
        setNeedsEmbedding(true);
        setHasPendingEmbeds(true);
        setEmbedPromptDismissed(false);
        setEmbedProgress({
          processed: 0,
          total: 0,
          status: "Ready to embed. Click Continue to start.",
        });
        setEnvIssues((prev) =>
          prev.includes(`Embedding preflight failed: ${String(e)}`)
            ? prev
            : [...prev, `Embedding preflight failed: ${String(e)}`],
        );
      }
    }

    void refreshNeedsEmbedding();
    return () => {
      cancelled = true;
    };
  }, [autoEmbedKey, cfg.include.length, embedding]);

  useEffect(() => {
    let cancelled = false;
    async function preflightPlan() {
      if (embedding) return;
      if (cfg.include.length === 0) return;
      if (!geminiApiKey) {
        if (!cancelled) setEmbedPlan({ totalSelected: null, pending: null, warning: null });
        return;
      }

      try {
        const res = (await invoke("scan_files_count", {
          args: { include: cfg.include, exclude: cfg.exclude, extensions: cfg.extensions },
        })) as { total: number } | { total: string };
        const totalSelected = typeof res.total === "string" ? Number.parseInt(res.total, 10) : res.total;
        const safeTotalSelected = Number.isFinite(totalSelected) ? totalSelected : 0;
        const toWarnOn = safeTotalSelected;
        const warning =
          toWarnOn >= 1500
            ? "Large embedding job detected (1500+ files). This may take a long time and consume significant API quota."
            : toWarnOn >= 500
              ? "Large embedding job detected (500+ files). Consider narrowing folders/types before continuing."
              : null;

        if (!cancelled) setEmbedPlan({ totalSelected: safeTotalSelected, pending: null, warning });
      } catch {
        if (!cancelled) setEmbedPlan({ totalSelected: null, pending: null, warning: null });
      }
    }
    void preflightPlan();
    return () => {
      cancelled = true;
    };
  }, [autoEmbedKey, cfg.exclude, cfg.extensions, cfg.include, cfg.sourceId, embedding, geminiApiKey]);

  return (
    <main className="min-h-screen w-full bg-[#f6f7fb] text-black">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <EnvIssuesBanner issues={envIssues} />
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
                needsEmbedding={needsEmbedding}
                embedPlan={embedPlan}
                embedPromptDismissed={embedPromptDismissed}
                onContinueEmbedding={async () => {
                  setEmbedPromptDismissed(false);
                  setNeedsEmbedding(false);
                  await runEmbed();
                }}
                onCancelEmbeddingPrompt={() => {
                  setEmbedPromptDismissed(true);
                  setNeedsEmbedding(false);
                  setHasPendingEmbeds(false);
                  setEmbedProgress({ processed: 0, total: 0, status: "Embedding not started." });
                }}
              />
            }
          />
        </Routes>
      </div>
    </main>
  );
}

