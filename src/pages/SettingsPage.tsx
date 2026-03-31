import { ArrowLeft, FolderPlus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { LocalConfig, SupportedExt } from "../lib/localConfig";
import { saveConfig } from "../lib/localConfig";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Progress } from "../components/ui/progress";

function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="group flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-black/5">
      <input
        type="checkbox"
        className="h-4 w-4 accent-black"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="font-medium tracking-tight">{label}</span>
    </label>
  );
}

export function SettingsPage({
  cfg,
  setCfg,
  embedding,
  embedProgress,
  runEmbed,
  extOptions,
}: {
  cfg: LocalConfig;
  setCfg: (next: LocalConfig) => void;
  embedding: boolean;
  embedProgress: {
    processed: number;
    total: number;
    status: string;
  };
  runEmbed: () => Promise<void>;
  extOptions: SupportedExt[];
}) {
  function updateConfig(next: LocalConfig) {
    setCfg(next);
    saveConfig(next);
  }

  async function pickFolder(label: string): Promise<string | null> {
    try {
      const selection = await openDialog({
        directory: true,
        multiple: false,
        title: label,
      });
      if (typeof selection === "string") return selection;
      return null;
    } catch {
      const dir = window.prompt(`${label} (absolute path)`);
      return dir && dir.trim().length > 0 ? dir.trim() : null;
    }
  }

  const progressValue =
    embedProgress.total > 0 ? (embedProgress.processed / embedProgress.total) * 100 : 0;

  return (
    <section>
      <div className="relative mb-8">
        <Link
          to="/"
          className="absolute left-0 top-0 inline-flex h-9 w-9 items-center justify-center rounded-md text-black/70 hover:bg-black/5 hover:text-black"
          aria-label="Back to search"
          title="Back"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Link>
        <PageHeader heading="Settings" subtitle="configure embedding" />
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <div className="p-2">
          <div className="flex items-baseline justify-between gap-3">
            <div className="font-semibold tracking-tight">Paths</div>
            <div className="text-xs text-black/50">Choose what gets embedded</div>
          </div>

          <div className="mt-4">
            <div className="text-xs font-medium uppercase tracking-wide text-black/50">Include</div>
            <div className="mt-2 flex flex-col gap-2">
              {cfg.include.length === 0 ? (
                <div className="text-sm text-black/50">No include folders yet.</div>
              ) : (
                cfg.include.map((p) => (
                  <div key={p} className="flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0 flex-1 truncate rounded-md bg-black/5 px-2 py-1 font-mono text-[12px] text-black/70">
                      {p}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        updateConfig({ ...cfg, include: cfg.include.filter((x) => x !== p) })
                      }
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      <span>Remove</span>
                    </Button>
                  </div>
                ))
              )}

              <Button
                className="mt-1"
                variant="ghost"
                onClick={async () => {
                  const dir = await pickFolder("Add include folder");
                  if (!dir) return;
                  if (cfg.include.includes(dir)) return;
                  updateConfig({ ...cfg, include: [...cfg.include, dir] });
                }}
              >
                <FolderPlus className="h-4 w-4" aria-hidden="true" />
                <span>Add include folder</span>
              </Button>
            </div>
          </div>

          <div className="mt-5">
            <div className="text-xs font-medium uppercase tracking-wide text-black/50">Exclude</div>
            <div className="mt-2 flex flex-col gap-2">
              {cfg.exclude.length === 0 ? (
                <div className="text-sm text-black/50">No exclude folders.</div>
              ) : (
                cfg.exclude.map((p) => (
                  <div key={p} className="flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0 flex-1 truncate rounded-md bg-black/5 px-2 py-1 font-mono text-[12px] text-black/70">
                      {p}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        updateConfig({ ...cfg, exclude: cfg.exclude.filter((x) => x !== p) })
                      }
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      <span>Remove</span>
                    </Button>
                  </div>
                ))
              )}

              <Button
                className="mt-1"
                variant="ghost"
                onClick={async () => {
                  const dir = await pickFolder("Add exclude folder");
                  if (!dir) return;
                  if (cfg.exclude.includes(dir)) return;
                  updateConfig({ ...cfg, exclude: [...cfg.exclude, dir] });
                }}
              >
                <FolderPlus className="h-4 w-4" aria-hidden="true" />
                <span>Add exclude folder</span>
              </Button>
            </div>
          </div>
        </div>

        <div className="p-2">
          <div className="flex items-baseline justify-between gap-3">
            <div className="font-semibold tracking-tight">Embedding</div>
          </div>

          <div className="mt-4">
            <div className="text-xs font-medium uppercase tracking-wide text-black/50">
              File types
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1">
              {extOptions.map((ext) => (
                <Checkbox
                  key={ext}
                  label={ext}
                  checked={cfg.extensions.includes(ext)}
                  onChange={(checked) => {
                    const next = checked
                      ? Array.from(new Set([...cfg.extensions, ext]))
                      : cfg.extensions.filter((x) => x !== ext);
                    updateConfig({ ...cfg, extensions: next });
                  }}
                />
              ))}
            </div>
          </div>

          <div className="mt-5">
            <div className="text-xs font-medium uppercase tracking-wide text-black/50">
              Search score threshold
            </div>
            <div className="mt-2 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={cfg.scoreThreshold}
                onChange={(e) =>
                  updateConfig({ ...cfg, scoreThreshold: Number.parseFloat(e.target.value) })
                }
                className="w-full"
              />
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={cfg.scoreThreshold}
                onChange={(e) => {
                  const next = Number.parseFloat(e.target.value);
                  if (Number.isNaN(next)) return;
                  updateConfig({ ...cfg, scoreThreshold: Math.max(0, Math.min(1, next)) });
                }}
                className="w-20 rounded-md border border-black/15 bg-white px-2 py-1 text-sm"
              />
            </div>
            <div className="mt-1 text-xs text-black/50">
              Only show results with score greater than or equal to this value.
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button onClick={runEmbed} disabled={embedding}>
              {embedding ? "Embedding…" : "Embed now"}
            </Button>
            <div className="text-xs text-black/50">Tip: fewer file types makes embedding faster.</div>
          </div>

          <div className="mt-5 rounded-lg border border-black/10 bg-white/70 p-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <div className="font-medium tracking-tight">
                {embedding ? "Embedding in progress" : "Embedding status"}
              </div>
              {embedProgress.total > 0 ? (
                <div className="text-xs tabular-nums text-black/60">
                  {embedProgress.processed}/{embedProgress.total}
                </div>
              ) : null}
            </div>
            <Progress className="mt-3" value={progressValue} />
            <div className="mt-2 text-xs text-black/60">{embedProgress.status}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

