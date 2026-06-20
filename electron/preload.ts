import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktop", {
  invoke: (channel: string, payload?: unknown) =>
    ipcRenderer.invoke(channel, payload) as Promise<unknown>,
  subscribe: (channel: string, listener: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => {
      listener(data);
    };
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
});
