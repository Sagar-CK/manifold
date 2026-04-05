import { FolderPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatPathForDisplay } from "@/lib/pathDisplay";
import { collapseIncludeFolders, type LocalConfig } from "@/lib/localConfig";

export function SettingsPathsCard({
  cfg,
  updateConfig,
  homePath,
  pickFolder,
  prepareAddIncludeFolder,
  prepareRemoveIncludeFolder,
  setConfirmDisableDefaultExcludesOpen,
}: {
  cfg: LocalConfig;
  updateConfig: (next: LocalConfig) => void;
  homePath: string;
  pickFolder: (label: string) => Promise<string | null>;
  prepareAddIncludeFolder: (path: string) => Promise<void>;
  prepareRemoveIncludeFolder: (path: string) => void;
  setConfirmDisableDefaultExcludesOpen: (open: boolean) => void;
}) {
  return (
    <Card size="sm" className="shadow-xs">
      <CardHeader>
        <CardTitle>Paths</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-muted-foreground">Include</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Add include folder"
                  onClick={async () => {
                    const dir = await pickFolder("Add include folder");
                    if (!dir) return;
                    const nextIncludes = collapseIncludeFolders([
                      ...cfg.include,
                      dir,
                    ]);
                    if (nextIncludes.length === cfg.include.length) return;
                    await prepareAddIncludeFolder(dir);
                  }}
                >
                  <FolderPlus className="h-4 w-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">Add folder</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex flex-col gap-2">
            {cfg.include.length === 0 ? (
              <p className="text-sm text-muted-foreground">None</p>
            ) : (
              cfg.include.map((p) => (
                <div
                  key={p}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <div className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs text-foreground">
                    {formatPathForDisplay(p, homePath)}
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Remove include folder ${formatPathForDisplay(p, homePath)}`}
                        onClick={() => {
                          prepareRemoveIncludeFolder(p);
                        }}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">Remove</TooltipContent>
                  </Tooltip>
                </div>
              ))
            )}
          </div>
        </div>

        <Separator />

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-muted-foreground">Exclude</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Add exclude folder"
                  onClick={async () => {
                    const dir = await pickFolder("Add exclude folder");
                    if (!dir) return;
                    if (cfg.exclude.includes(dir)) return;
                    updateConfig({
                      ...cfg,
                      exclude: [...cfg.exclude, dir],
                    });
                  }}
                >
                  <FolderPlus className="h-4 w-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">Add folder</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex flex-col gap-2">
            {cfg.exclude.length === 0 ? (
              <p className="text-sm text-muted-foreground">None</p>
            ) : (
              cfg.exclude.map((p) => (
                <div
                  key={p}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <div className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs text-foreground">
                    {formatPathForDisplay(p, homePath)}
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Remove exclude folder ${formatPathForDisplay(p, homePath)}`}
                        onClick={() =>
                          updateConfig({
                            ...cfg,
                            exclude: cfg.exclude.filter((x) => x !== p),
                          })
                        }
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">Remove</TooltipContent>
                  </Tooltip>
                </div>
              ))
            )}
          </div>
        </div>

        <Separator />

        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor="default-excludes">
              Skip dependency / build folders
            </Label>
            <p className="text-xs text-muted-foreground">
              e.g. <span className="font-mono">node_modules</span>,{" "}
              <span className="font-mono">.git</span>,{" "}
              <span className="font-mono">dist</span>
            </p>
          </div>
          <Switch
            id="default-excludes"
            checked={cfg.useDefaultFolderExcludes}
            onCheckedChange={(checked) => {
              if (checked) {
                updateConfig({
                  ...cfg,
                  useDefaultFolderExcludes: true,
                });
              } else {
                setConfirmDisableDefaultExcludesOpen(true);
              }
            }}
            aria-label="Skip common dependency and build folders"
            className="shrink-0"
          />
        </div>
      </CardContent>
    </Card>
  );
}
