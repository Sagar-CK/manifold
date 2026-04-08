import { useSyncExternalStore } from "react";

type CreateLocalStorageStoreOptions<T> = {
  key: string;
  defaultValue: () => T;
  deserialize: (raw: string) => T;
  serialize: (value: T) => string;
};

type Listener = () => void;

export function createLocalStorageStore<T>({
  key,
  defaultValue,
  deserialize,
  serialize,
}: CreateLocalStorageStoreOptions<T>) {
  let current = readSnapshot();
  const listeners = new Set<Listener>();
  let storageListenerInstalled = false;

  function readSnapshot(): T {
    if (typeof window === "undefined") {
      return defaultValue();
    }
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return defaultValue();
    }
    try {
      return deserialize(raw);
    } catch {
      return defaultValue();
    }
  }

  function emit() {
    for (const listener of listeners) {
      listener();
    }
  }

  function persist(next: T) {
    current = next;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(key, serialize(next));
    }
    emit();
  }

  function ensureStorageListener() {
    if (storageListenerInstalled || typeof window === "undefined") {
      return;
    }
    storageListenerInstalled = true;
    window.addEventListener("storage", (event) => {
      if (event.key !== key) {
        return;
      }
      current = readSnapshot();
      emit();
    });
  }

  function getSnapshot(): T {
    return current;
  }

  function setSnapshot(next: T | ((prev: T) => T)): void {
    const resolved =
      typeof next === "function" ? (next as (prev: T) => T)(current) : next;
    persist(resolved);
  }

  function subscribe(listener: Listener): () => void {
    ensureStorageListener();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function useStore(): [T, typeof setSnapshot] {
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, defaultValue);
    return [snapshot, setSnapshot];
  }

  return {
    getSnapshot,
    setSnapshot,
    subscribe,
    useStore,
  };
}
