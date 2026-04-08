import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";

export function useStoredState<T>(
  key: string,
  fallback: () => T,
  normalize: (value: unknown) => T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") {
      return fallback();
    }
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        return fallback();
      }
      return normalize(JSON.parse(raw) as unknown);
    } catch {
      return fallback();
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}
