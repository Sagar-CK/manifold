import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalStorageStore } from "@/lib/stores/localStorageStore";

function createFakeWindow() {
  const storage = new Map<string, string>();

  return {
    localStorage: {
      getItem(key: string) {
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
      removeItem(key: string) {
        storage.delete(key);
      },
      clear() {
        storage.clear();
      },
    },
    addEventListener: vi.fn(),
  };
}

describe("createLocalStorageStore", () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: createFakeWindow(),
      writable: true,
    });
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
      return;
    }

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
      writable: true,
    });
  });

  it("persists snapshots and exposes the current normalized value", () => {
    const store = createLocalStorageStore<number>({
      key: "manifold:test",
      defaultValue: () => 1,
      deserialize(raw) {
        return Number.parseInt(raw, 10);
      },
      serialize(value) {
        return String(value);
      },
    });

    expect(store.getSnapshot()).toBe(1);

    store.setSnapshot(7);

    expect(store.getSnapshot()).toBe(7);
    expect(window.localStorage.getItem("manifold:test")).toBe("7");
  });
});
