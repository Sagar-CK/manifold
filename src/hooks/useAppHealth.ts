import { useCallback, useEffect, useState } from "react";
import { qdrantStatus } from "@/lib/api/tauri";
import { invokeErrorText } from "@/lib/errors";

export function useAppHealth(): {
  envIssues: string[];
  refreshHealth: () => Promise<void>;
} {
  const [envIssues, setEnvIssues] = useState<string[]>([]);

  const refreshHealth = useCallback(async () => {
    const issues: string[] = [];
    try {
      await qdrantStatus();
    } catch (error) {
      issues.push(
        `Qdrant is not configured or reachable: ${invokeErrorText(error)}`,
      );
    }
    setEnvIssues(issues);
  }, []);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  return { envIssues, refreshHealth };
}
