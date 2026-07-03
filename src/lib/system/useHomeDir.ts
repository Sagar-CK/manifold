import { useEffect, useState } from "react";
import { getHomeDir } from "@/lib/api/desktop";

export function useHomeDir(): string {
  const [homePath, setHomePath] = useState("");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const home = await getHomeDir();
        if (!cancelled) setHomePath(home);
      } catch {
        if (!cancelled) setHomePath("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return homePath;
}
