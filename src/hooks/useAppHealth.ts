import { useCallback, useEffect, useState } from "react";
import {
  geminiApiKeyStatus,
  isDesktopAvailable,
  qdrantStatus,
  startQdrantDocker,
} from "@/lib/api/desktop";
import { invokeErrorText } from "@/lib/errors";
import { createLogger } from "@/lib/log";

export type EnvIssue = {
  id: "qdrant-unreachable" | "gemini-missing";
  title: string;
  message: string;
  /** Show the one-click Docker setup action for this issue. */
  quickSetup?: "docker";
};

function qdrantIssueMessage(error: unknown): string {
  const detail = invokeErrorText(error);
  if (/6333|qdrant|fetch failed/i.test(detail)) {
    return "Qdrant isn't running on this machine yet.";
  }
  return `Qdrant isn't configured: ${detail}`;
}

const setupLog = createLogger("setup");

export function useAppHealth(): {
  envIssues: EnvIssue[];
  refreshHealth: () => Promise<boolean>;
  startQdrantDockerContainer: () => Promise<{ message: string }>;
} {
  const [envIssues, setEnvIssues] = useState<EnvIssue[]>([]);

  const refreshHealth = useCallback(async (): Promise<boolean> => {
    setupLog.debug("refreshing app health");
    if (!isDesktopAvailable()) {
      setupLog.debug("desktop API not ready — skipping health check");
      setEnvIssues([]);
      return true;
    }
    const issues: EnvIssue[] = [];
    try {
      await qdrantStatus();
      setupLog.info("Qdrant health check passed");
    } catch (error) {
      const message = qdrantIssueMessage(error);
      setupLog.warn(`Qdrant health check failed: ${message}`);
      issues.push({
        id: "qdrant-unreachable",
        title: "Start Qdrant",
        message,
        quickSetup: "docker",
      });
    }

    try {
      const gemini = await geminiApiKeyStatus();
      if (!gemini.configured) {
        issues.push({
          id: "gemini-missing",
          title: "Add Gemini API key",
          message: "Save a Google AI key in Settings → General.",
        });
      }
    } catch (error) {
      setupLog.warn("Gemini key status check failed", {
        error: invokeErrorText(error),
      });
    }

    setEnvIssues(issues);
    return issues.length === 0;
  }, []);

  const startQdrantDockerContainer = useCallback(async () => {
    setupLog.info("Starting Qdrant via Docker quick setup");
    try {
      const result = await startQdrantDocker();
      setupLog.info("Qdrant Docker quick setup finished", result);
      const healthy = await refreshHealth();
      if (!healthy) {
        throw new Error(
          "Qdrant started but isn't responding yet. Wait a few seconds and try again.",
        );
      }
      return result;
    } catch (error) {
      setupLog.error("Qdrant Docker quick setup failed", {
        error: invokeErrorText(error),
      });
      throw error;
    }
  }, [refreshHealth]);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  return { envIssues, refreshHealth, startQdrantDockerContainer };
}
