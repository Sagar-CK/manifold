import { createContext, useContext } from "react";
import { useAppHealth } from "@/hooks/useAppHealth";

import type { EnvIssue } from "@/hooks/useAppHealth";

type AppHealthContextValue = {
  envIssues: EnvIssue[];
  refreshHealth: () => Promise<boolean>;
  startQdrantDockerContainer: () => Promise<{ message: string }>;
};

const AppHealthContext = createContext<AppHealthContextValue | null>(null);

export function AppHealthProvider({ children }: { children: React.ReactNode }) {
  const health = useAppHealth();
  return (
    <AppHealthContext.Provider value={health}>{children}</AppHealthContext.Provider>
  );
}

export function useAppHealthContext(): AppHealthContextValue {
  const ctx = useContext(AppHealthContext);
  if (!ctx) {
    throw new Error("useAppHealthContext must be used within AppHealthProvider");
  }
  return ctx;
}
