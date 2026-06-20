import type { BrowserWindow } from "electron";
import { userDataDir } from "../app-paths.js";
import { TextIndexState } from "../text-index.js";

export type IpcDeps = {
  getMainWindow: () => BrowserWindow | null;
  broadcast: (channel: string, payload: unknown) => void;
};

export type IpcContext = IpcDeps & {
  ud: () => string;
  textIndex: TextIndexState;
};

export const textIndexState = new TextIndexState();

export function createIpcContext(deps: IpcDeps): IpcContext {
  return {
    ...deps,
    ud: userDataDir,
    textIndex: textIndexState,
  };
}

export function unwrapArgs<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "args" in payload) {
    return (payload as { args: T }).args;
  }
  return payload as T;
}
