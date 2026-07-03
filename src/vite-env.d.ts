/// <reference types="vite/client" />

type ManifoldDesktopApi = {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>;
  subscribe: (channel: string, listener: (data: unknown) => void) => () => void;
};

interface Window {
  desktop?: ManifoldDesktopApi;
}
