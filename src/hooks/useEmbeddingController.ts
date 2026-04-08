import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelEmbeddingJob,
  type EmbeddingFileFailure,
  type EmbeddingJobPhase,
  embeddingJobStatus,
  qdrantStatus,
  startEmbeddingJob,
  subscribeEmbeddingDone,
  subscribeEmbeddingError,
  subscribeEmbeddingFileFailed,
  subscribeEmbeddingStatus,
} from "@/lib/api/tauri";
import { invokeErrorText } from "@/lib/errors";
import {
  embeddingImageRasterOptions,
  type LocalConfig,
} from "@/lib/localConfig";

function embedAutoKeyFromCfg(cfg: LocalConfig): string {
  return JSON.stringify({
    include: [...cfg.include].sort(),
    exclude: [...cfg.exclude].sort(),
    extensions: [...cfg.extensions].sort(),
    useDefaultFolderExcludes: cfg.useDefaultFolderExcludes,
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

  const autoEmbedKey = useMemo(
    () => embedAutoKeyFromCfg(cfg),
    [
      cfg.exclude,
      cfg.extensions,
      cfg.include,
      cfg.sourceId,
      cfg.useDefaultFolderExcludes,
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
      } catch (error) {
        const message = `Qdrant is not configured or reachable: ${invokeErrorText(error)}`;
        lastReportedEmbedErrorRef.current = message;
        setLastEmbedError(message);
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
    let cancelled = false;

    async function subscribe() {
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
        setEmbedFailures((prev) => [failure, ...prev].slice(0, 8));
      });

      try {
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
        // ignore initial status fetch failures
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

  return {
    embedding,
    hasPendingEmbeds,
    embeddingPhase,
    embedProgress,
    lastEmbedError,
    embedFailures,
    cancelEmbedding,
    clearGeminiEmbedError,
    onGeminiApiKeySaved,
  };
}
