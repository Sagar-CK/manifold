import "./App.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { loadConfig, type LocalConfig, type SupportedExt } from "./lib/localConfig";
import { syncTagsBackfill } from "./lib/qdrantTags";
import { loadTagsState } from "./lib/tags";
import { EnvIssuesBanner } from "./components/EnvIssuesBanner";
import { KeyboardShortcutsHelp } from "./components/KeyboardShortcutsHelp";
import { FileResultPage } from "./pages/FileResultPage";
import { GraphExplorerPage } from "./pages/GraphExplorerPage";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ReviewTagsPage } from "./pages/ReviewTagsPage";
import { setNavigateToReviewTagsCallback } from "./lib/autoTagging";
import { cn } from "./lib/utils";

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
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const graphLayout = pathname === "/graph";
  const [cfg, setCfg] = useState<LocalConfig>(() => loadConfig());
  const [embeddingPhase, setEmbeddingPhase] = useState<EmbeddingJobPhase>("idle");
  const [envIssues, setEnvIssues] = useState<string[]>([]);
  const [embedProgress, setEmbedProgress] = useState({
    processed: 0,
    total: 0,
    status: "All files indexed.",
  });
  const [lastEmbedError, setLastEmbedError] = useState<string | null>(null);
  const [embedFailures, setEmbedFailures] = useState<EmbeddingFileFailure[]>([]);
  const lastAutoEmbedKeyRef = useRef<string>("");

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
        useDefaultFolderExcludes: cfg.useDefaultFolderExcludes,
        sourceId: cfg.sourceId,
      }),
    [cfg.exclude, cfg.extensions, cfg.include, cfg.sourceId, cfg.useDefaultFolderExcludes],
  );
  const embedding =
    embeddingPhase === "scanning" ||
    embeddingPhase === "embedding" ||
    embeddingPhase === "paused" ||
    embeddingPhase === "cancelling";
  const hasPendingEmbeds = embedding;

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

  /** One-time per source: push local tag membership into Qdrant payloads for paths that already exist in the index. */
  useEffect(() => {
    const key = `manifold:tagsQdrantBackfill:v1:${cfg.sourceId}`;
    if (typeof window === "undefined" || localStorage.getItem(key)) return;
    let cancelled = false;
    async function run() {
      const state = loadTagsState();
      const entries = Object.entries(state.pathToTagIds).map(([path, tagIds]) => ({
        path,
        tagIds,
      }));
      if (entries.length === 0) {
        localStorage.setItem(key, "1");
        return;
      }
      const BATCH = 64;
      try {
        for (let i = 0; i < entries.length; i += BATCH) {
          if (cancelled) return;
          const chunk = entries.slice(i, i + BATCH);
          await syncTagsBackfill(cfg.sourceId, chunk);
        }
        if (!cancelled) localStorage.setItem(key, "1");
      } catch {
        /* Qdrant down or offline; retry on next launch */
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [cfg.sourceId]);

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
        scan: {
          include: cfg.include,
          exclude: cfg.exclude,
          extensions: cfg.extensions,
          useDefaultFolderExcludes: cfg.useDefaultFolderExcludes,
        },
        sourceId: cfg.sourceId,
      },
    });
  }, [cfg.exclude, cfg.extensions, cfg.include, cfg.sourceId, cfg.useDefaultFolderExcludes, geminiApiKey]);

  useEffect(() => {
    if (cfg.include.length === 0) {
      setEmbeddingPhase("idle");
      setEmbedProgress({ processed: 0, total: 0, status: "All files indexed." });
      return;
    }
    if (embedding) return;
    if (lastAutoEmbedKeyRef.current === autoEmbedKey) return;
    lastAutoEmbedKeyRef.current = autoEmbedKey;
    void runEmbed().catch((e) => {
      setLastEmbedError(String(e));
    });
  }, [autoEmbedKey, cfg.include.length, embedding, runEmbed]);

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
      });
      unlistenDone = await listen("embedding://done", () => {
        setEmbeddingPhase("done");
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
  }, []);

  useEffect(() => {
    setNavigateToReviewTagsCallback(() => {
      navigate("/review-tags");
    });
  }, [navigate]);

  return (
    <main className="h-screen w-full overflow-hidden bg-[#f6f7fb] text-black">
      <div
        className={cn(
          "mx-auto flex h-full min-h-0 flex-col px-6 py-8",
          graphLayout ? "max-w-[min(100%,1400px)]" : "max-w-5xl",
        )}
      >
        <EnvIssuesBanner issues={envIssues} />
        <div className="flex min-h-0 flex-1 flex-col">
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
          <Route path="/file" element={<FileResultPage cfg={cfg} />} />
          <Route path="/graph" element={<GraphExplorerPage cfg={cfg} />} />
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
          <Route path="/review-tags" element={<ReviewTagsPage sourceId={cfg.sourceId} />} />
        </Routes>
        </div>
      </div>
      <KeyboardShortcutsHelp />
    </main>
  );
}

