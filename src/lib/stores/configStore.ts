import {
  createDefaultLocalConfig,
  type LocalConfig,
  normalizeLocalConfig,
} from "@/lib/localConfig";
import { createLocalStorageStore } from "@/lib/stores/localStorageStore";

const KEY = "manifold:config:v1";

const store = createLocalStorageStore<LocalConfig>({
  key: KEY,
  defaultValue: createDefaultLocalConfig,
  deserialize(raw) {
    return normalizeLocalConfig(JSON.parse(raw) as Partial<LocalConfig>);
  },
  serialize(value) {
    return JSON.stringify(normalizeLocalConfig(value));
  },
});

export function useConfigStore(): [LocalConfig, typeof store.setSnapshot] {
  return store.useStore();
}
