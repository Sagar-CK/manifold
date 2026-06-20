import { dialog, ipcMain, shell } from "electron";
import { unwrapArgs, type IpcDeps } from "./context.js";

export function registerAppHandlers(deps: IpcDeps): void {
  ipcMain.handle("app_get_home_dir", async () => {
    const os = await import("node:os");
    return os.homedir();
  });

  ipcMain.handle("shell_open_path", async (_e, payload) => {
    const args = unwrapArgs<{ path: string }>(payload);
    return await shell.openPath(args.path);
  });

  ipcMain.handle("shell_open_external", async (_e, payload) => {
    const args = unwrapArgs<{ url: string }>(payload);
    await shell.openExternal(args.url);
  });

  ipcMain.handle("dialog_open_directory", async (_e, payload) => {
    const args = unwrapArgs<{ title?: string }>(payload);
    const win = deps.getMainWindow();
    const opts: Electron.OpenDialogOptions = {
      title: args.title,
      properties: ["openDirectory", "createDirectory"],
    };
    const r = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (r.canceled || r.filePaths.length === 0) return null;
    return r.filePaths[0] ?? null;
  });
}
