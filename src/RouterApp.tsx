import "./App.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { loadConfig, type LocalConfig, type SupportedExt } from "./lib/localConfig";
import { EnvIssuesBanner } from "./components/EnvIssuesBanner";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";

type EmbeddingJobPhase =
  | "idle"
  | "scanning"
  | "embedding"
  | "paused"
  | "cancelling"
  | "done"
  | "error";

type EmbeddingJobStatus = {
  phase: EmbeddingJobPhase;
  processed: number;
  total: number;
  message: string;
};

type EmbeddingFileFailure = {
  path: string;
  reason: string;
};

export default function RouterApp() {
  const [cfg, setCfg] = useState<LocalConfig>(() => loadConfig());
  const [embedding, setEmbedding] = useState(false);
  const [embeddingPhase, setEmbeddingPhase] = useState<EmbeddingJobPhase>("idle");
  const [envIssues, setEnvIssues] = useState<string[]>([]);
  const [embedPromptDismissed, setEmbedPromptDismissed] = useState(false);
  const [embedProgress, setEmbedProgress] = useState({
    processed: 0,
    total: 0,
    status: "All files indexed.",
  });
  const [hasPendingEmbeds, setHasPendingEmbeds] = useState(false);
  const [needsEmbedding, setNeedsEmbedding] = useState(false);
  const [embedPlan, setEmbedPlan] = useState<{
    totalSelected: number | null;
    pending: number | null;
    warning: string | null;
  }>({ totalSelected: null, pending: null, warning: null });
  const [lastEmbedError, setLastEmbedError] = useState<string | null>(null);
  const [embedFailures, setEmbedFailures] = useState<EmbeddingFileFailure[]>([]);

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
    if (cfg.include.length === 0) {
      return;
    }

    // Preflight Qdrant once to avoid a laggy first upsert when Qdrant is down.
    try {
      await invoke("qdrant_status");
    } catch (e) {
      const msg = `Qdrant is not configured or reachable: ${String(e)}`;
      setLastEmbedError(msg);
      setEnvIssues((prev) => (prev.includes(msg) ? prev : [...prev, msg]));
      return;
    }

    setLastEmbedError(null);
    setEmbedFailures([]);
    await invoke("start_embedding_job", {
      args: {
        scan: { include: cfg.include, exclude: cfg.exclude, extensions: cfg.extensions },
        sourceId: cfg.sourceId,
      },
    });
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
        setEmbedProgress({ processed: 0, total: 0, status: "All files indexed." });
        setEmbedPlan({ totalSelected: null, pending: null, warning: null });
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
          status: needs ? "Starting indexing…" : "All files indexed.",
        });

        // Auto-start embedding when selections change.
        if (needs) {
          try {
            await runEmbed();
          } catch (e) {
            setLastEmbedError(String(e));
          }
        }
      } catch (e) {
        if (cancelled) return;
        // If preflight fails, fall back to attempting an explicit start anyway.
        setNeedsEmbedding(true);
        setHasPendingEmbeds(true);
        setEmbedPromptDismissed(false);
        setEmbedProgress({
          processed: 0,
          total: 0,
          status: "Starting indexing…",
        });
        setEnvIssues((prev) =>
          prev.includes(`Indexing preflight failed: ${String(e)}`)
            ? prev
            : [...prev, `Indexing preflight failed: ${String(e)}`],
        );
        try {
          await runEmbed();
        } catch (err) {
          setLastEmbedError(String(err));
        }
      }
    }

    void refreshNeedsEmbedding();
    return () => {
      cancelled = true;
    };
  }, [autoEmbedKey, cfg.include.length, embedding, runEmbed]);

  useEffect(() => {
    let cancelled = false;
    async function preflightPlan() {
      if (embedding) return;
      if (cfg.include.length === 0) return;

      try {
        const res = (await invoke("scan_files_count", {
          args: { include: cfg.include, exclude: cfg.exclude, extensions: cfg.extensions },
        })) as { total: number } | { total: string };
        const totalSelected = typeof res.total === "string" ? Number.parseInt(res.total, 10) : res.total;
        const safeTotalSelected = Number.isFinite(totalSelected) ? totalSelected : 0;
        const toWarnOn = safeTotalSelected;
        const warning =
          toWarnOn >= 1500
            ? "Large indexing job detected (1500+ files). This may take a long time and consume significant API quota."
            : toWarnOn >= 500
              ? "Large indexing job detected (500+ files). Consider narrowing folders/types before continuing."
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
  }, [autoEmbedKey, cfg.exclude, cfg.extensions, cfg.include, cfg.sourceId, embedding]);

  useEffect(() => {
    let unlistenStatus: (() => void) | null = null;
    let unlistenDone: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;
    let unlistenFileFailed: (() => void) | null = null;
    let cancelled = false;

    async function subscribe() {
      unlistenStatus = await listen<EmbeddingJobStatus>("embedding://status", (event) => {
        const s = event.payload;
        setEmbeddingPhase(s.phase);
        setEmbedProgress({ processed: s.processed, total: s.total, status: s.message });
        const active =
          s.phase === "scanning" || s.phase === "embedding" || s.phase === "paused" || s.phase === "cancelling";
        setEmbedding(active);
        setHasPendingEmbeds(active || needsEmbedding);
      });
      unlistenDone = await listen("embedding://done", () => {
        setEmbedding(false);
        setEmbeddingPhase("done");
        setHasPendingEmbeds(false);
      });
      unlistenError = await listen<{ message: string }>("embedding://error", (event) => {
        setLastEmbedError(event.payload.message);
      });
      unlistenFileFailed = await listen<EmbeddingFileFailure>("embedding://file-failed", (event) => {
        setEmbedFailures((prev) => {
          const next = [event.payload, ...prev];
          return next.slice(0, 8);
        });
      });

      try {
        const status = (await invoke("embedding_job_status")) as EmbeddingJobStatus;
        if (cancelled) return;
        setEmbeddingPhase(status.phase);
        setEmbedProgress({
          processed: status.processed,
          total: status.total,
          status: status.message,
        });
        const active =
          status.phase === "scanning" ||
          status.phase === "embedding" ||
          status.phase === "paused" ||
          status.phase === "cancelling";
        setEmbedding(active);
        setHasPendingEmbeds(active || needsEmbedding);
      } catch {
        // ignore
      }
    }

    void subscribe();
    return () => {
      cancelled = true;
      unlistenStatus?.();
      unlistenDone?.();
      unlistenError?.();
      unlistenFileFailed?.();
    };
  }, [needsEmbedding]);

  return (
    <main className="min-h-screen w-full bg-[#f6f7fb] text-black">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <EnvIssuesBanner issues={envIssues} />
        <Routes>
          <Route
            path="/"
            element={
              <SearchPage
                cfg={cfg}
                embedding={embedding}
                hasPendingEmbeds={hasPendingEmbeds}
                embeddingPhase={embeddingPhase}
                embedProgress={embedProgress}
                lastEmbedError={lastEmbedError}
                embedFailures={embedFailures}
              />
            }
          />
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
                embeddingPhase={embeddingPhase}
                lastEmbedError={lastEmbedError}
                embedFailures={embedFailures}
                onCancelEmbedding={async () => {
                  await invoke("cancel_embedding_job");
                }}
              />
            }
          />
        </Routes>
      </div>
    </main>
  );
}

