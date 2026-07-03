import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelEmbeddingJob,
  type EmbeddingFileFailure,
  type EmbeddingJobPhase,
  embeddingJobStatus,
  isDesktopAvailable,
  qdrantStatus,
  startEmbeddingJob,
  subscribeEmbeddingDone,
  subscribeEmbeddingError,
  subscribeEmbeddingFileEmbedded,
  subscribeEmbeddingFileFailed,
  subscribeEmbeddingStatus,
} from "@/lib/api/desktop";
import {
  embeddingImageRasterOptions,
  type LocalConfig,
} from "@/lib/config/localConfig";
import { invokeErrorText } from "@/lib/errors";
import {
  clearIgnoredEmbedFailurePath,
  filterIgnoredEmbedFailures,
  ignoredEmbedFailuresStore,
  ignoreEmbedFailurePath,
  isEmbedFailureIgnored,
} from "@/lib/stores/ignoredEmbedFailuresStore";

function embedAutoKeyFromCfg(cfg: LocalConfig): string {
  return JSON.stringify({
    include: [...cfg.include].sort(),
    exclude: [...cfg.exclude].sort(),
    extensions: [...cfg.extensions].sort(),
    useDefaultFolderExcludes: cfg.useDefaultFolderExcludes,
    defaultFolderExcludeSegments: [...cfg.defaultFolderExcludeSegments].sort(),
    sourceId: cfg.sourceId,
  });
}

function isBenignConcurrentEmbedStartError(message: string): boolean {
  return /embedding job already running/i.test(message);
}

export function useEmbeddingController(cfg: LocalConfig) {
  const [embeddingPhase, setEmbeddingPhase] =
    useState<EmbeddingJobPhase>("idle");
  const [embedProgress, setEmbedProgress] = useState({
    processed: 0,
    total: 0,
    status: "All files indexed.",
  });
  const [lastEmbedError, setLastEmbedError] = useState<string | null>(null);
  const [embedFailures, setEmbedFailures] = useState<EmbeddingFileFailure[]>(
    [],
  );
  const lastAutoEmbedKeyRef = useRef<string>("");
  const embedStartInFlightRef = useRef(false);
  const lastReportedEmbedErrorRef = useRef<string | null>(null);

  const [ignoredEmbedPaths] = ignoredEmbedFailuresStore.useStore();

  const visibleEmbedFailures = useMemo(
    () => filterIgnoredEmbedFailures(embedFailures),
    [embedFailures, ignoredEmbedPaths],
  );

  const ignoreEmbedFailure = useCallback((path: string) => {
    ignoreEmbedFailurePath(path);
    setEmbedFailures((prev) => prev.filter((f) => f.path !== path));
  }, []);

  const autoEmbedKey = useMemo(
    () => embedAutoKeyFromCfg(cfg),
    [
      cfg.exclude,
      cfg.extensions,
      cfg.include,
      cfg.sourceId,
      cfg.useDefaultFolderExcludes,
      cfg.defaultFolderExcludeSegments,
    ],
  );

  const embedding =
    embeddingPhase === "scanning" ||
    embeddingPhase === "embedding" ||
    embeddingPhase === "paused" ||
    embeddingPhase === "cancelling";
  const hasPendingEmbeds = embedding;

  const clearGeminiEmbedError = useCallback(() => {
    setLastEmbedError(null);
    lastReportedEmbedErrorRef.current = null;
    setEmbedFailures([]);
  }, []);

  const runEmbed = useCallback(async () => {
    if (cfg.include.length === 0 || embedStartInFlightRef.current) {
      return;
    }

    embedStartInFlightRef.current = true;
    try {
      try {
        await qdrantStatus();
      } catch {
        // Setup onboarding surfaces Qdrant and Gemini configuration issues.
        return;
      }

      clearGeminiEmbedError();
      const visionRaster = embeddingImageRasterOptions(
        cfg.embeddingImagePreset,
      );
      await startEmbeddingJob({
        scan: {
          include: cfg.include,
          exclude: cfg.exclude,
          extensions: cfg.extensions,
          useDefaultFolderExcludes: cfg.useDefaultFolderExcludes,
          defaultFolderExcludeSegments: cfg.defaultFolderExcludeSegments,
        },
        sourceId: cfg.sourceId,
        visionRaster,
      });
      lastAutoEmbedKeyRef.current = embedAutoKeyFromCfg(cfg);
    } catch (error) {
      const message = invokeErrorText(error);
      if (
        isBenignConcurrentEmbedStartError(message) ||
        lastReportedEmbedErrorRef.current === message
      ) {
        return;
      }
      lastReportedEmbedErrorRef.current = message;
      setLastEmbedError(message);
    } finally {
      embedStartInFlightRef.current = false;
    }
  }, [
    cfg.embeddingImagePreset,
    cfg.exclude,
    cfg.extensions,
    cfg.include,
    cfg.sourceId,
    cfg.useDefaultFolderExcludes,
    cfg.defaultFolderExcludeSegments,
    clearGeminiEmbedError,
  ]);

  const cancelEmbedding = useCallback(async () => {
    await cancelEmbeddingJob();
  }, []);

  const onGeminiApiKeySaved = useCallback(() => {
    clearGeminiEmbedError();
    if (cfg.include.length > 0 && !embedding) {
      void runEmbed();
    }
  }, [cfg.include.length, clearGeminiEmbedError, embedding, runEmbed]);

  const retryEmbedding = useCallback(() => {
    if (embedding || embedStartInFlightRef.current) return;
    for (const failure of embedFailures) {
      clearIgnoredEmbedFailurePath(failure.path);
    }
    void runEmbed();
  }, [embedFailures, embedding, runEmbed]);

  useEffect(() => {
    if (cfg.include.length === 0) {
      setEmbeddingPhase("idle");
      setEmbedProgress({
        processed: 0,
        total: 0,
        status: "All files indexed.",
      });
      lastAutoEmbedKeyRef.current = autoEmbedKey;
      return;
    }
    if (embedding || lastAutoEmbedKeyRef.current === autoEmbedKey) {
      return;
    }
    void runEmbed();
  }, [autoEmbedKey, cfg.include.length, embedding, runEmbed]);

  useEffect(() => {
    let unlistenStatus: (() => void) | null = null;
    let unlistenDone: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;
    let unlistenFileFailed: (() => void) | null = null;
    let unlistenFileEmbedded: (() => void) | null = null;
    let cancelled = false;

    async function subscribe() {
      if (!isDesktopAvailable()) return;

      try {
        unlistenStatus = await subscribeEmbeddingStatus((status) => {
          setEmbeddingPhase(status.phase);
          setEmbedProgress({
            processed: status.processed,
            total: status.total,
            status: status.message,
          });
        });
        unlistenDone = await subscribeEmbeddingDone(() => {
          setEmbeddingPhase("done");
        });
        unlistenError = await subscribeEmbeddingError(({ message }) => {
          if (
            isBenignConcurrentEmbedStartError(message) ||
            lastReportedEmbedErrorRef.current === message
          ) {
            return;
          }
          lastReportedEmbedErrorRef.current = message;
          setLastEmbedError(message);
        });
        unlistenFileFailed = await subscribeEmbeddingFileFailed((failure) => {
          if (isEmbedFailureIgnored(failure.path)) return;
          setEmbedFailures((prev) => {
            const without = prev.filter((f) => f.path !== failure.path);
            return [...without, failure].slice(0, 128);
          });
        });
        unlistenFileEmbedded = await subscribeEmbeddingFileEmbedded(
          ({ path }) => {
            clearIgnoredEmbedFailurePath(path);
            setEmbedFailures((prev) => prev.filter((f) => f.path !== path));
          },
        );

        const status = await embeddingJobStatus();
        if (cancelled) {
          return;
        }
        setEmbeddingPhase(status.phase);
        setEmbedProgress({
          processed: status.processed,
          total: status.total,
          status: status.message,
        });
      } catch {
        // Preload/desktop API not ready yet.
      }
    }

    void subscribe();
    return () => {
      cancelled = true;
      unlistenStatus?.();
      unlistenDone?.();
      unlistenError?.();
      unlistenFileFailed?.();
      unlistenFileEmbedded?.();
    };
  }, []);

  return {
    embedding,
    hasPendingEmbeds,
    embeddingPhase,
    embedProgress,
    lastEmbedError,
    embedFailures: visibleEmbedFailures,
    ignoreEmbedFailure,
    retryEmbedding,
    cancelEmbedding,
    clearGeminiEmbedError,
    onGeminiApiKeySaved,
  };
}
