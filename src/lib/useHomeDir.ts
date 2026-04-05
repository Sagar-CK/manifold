import { homeDir } from "@tauri-apps/api/path";
import { useEffect, useState } from "react";

export function useHomeDir(): string {
  const [homePath, setHomePath] = useState("");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const home = await homeDir();
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
