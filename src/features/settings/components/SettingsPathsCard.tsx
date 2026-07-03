import {
  Cancel01Icon,
  Delete02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { HugeIcon } from "@/components/ui/huge-icon";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  collapseIncludeFolders,
  DEFAULT_FOLDER_EXCLUDE_SEGMENTS,
  type LocalConfig,
  normalizeExcludeSegments,
} from "@/lib/config/localConfig";

function PathRow({
  path,
  homePath,
  onRemove,
}: {
  path: string;
  homePath: string;
  onRemove: (path: string) => void;
}) {
  const display = path.startsWith(`${homePath}/`)
    ? `~/${path.slice(homePath.length + 1)}`
    : path === homePath
      ? "~"
      : path;

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg bg-muted/45 px-3 py-2">
      <div className="min-w-0 flex-1 truncate text-sm text-foreground/85">
        {display}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-muted-foreground"
        aria-label={`Remove ${display}`}
        onClick={() => onRemove(path)}
      >
        <HugeIcon icon={Delete02Icon} aria-hidden />
      </Button>
    </div>
  );
}

function EmptyPathPlaceholder() {
  return (
    <div
      className="h-9 rounded-lg border border-dashed border-border/55 bg-muted/10"
      aria-hidden
    />
  );
}

function PathSection({
  label,
  paths,
  homePath,
  addLabel,
  onRemove,
  onAdd,
}: {
  label: string;
  paths: string[];
  homePath: string;
  addLabel: string;
  onRemove: (path: string) => void;
  onAdd: () => void;
}) {
  return (
    <Field className="gap-2">
      <div className="flex items-center justify-between gap-3">
        <FieldLabel className="mb-0">{label}</FieldLabel>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="shrink-0"
          aria-label={addLabel}
          onClick={onAdd}
        >
          <HugeIcon icon={PlusSignIcon} aria-hidden />
        </Button>
      </div>

      {paths.length > 0 ? (
        <div className="flex flex-col gap-2">
          {paths.map((p) => (
            <PathRow key={p} path={p} homePath={homePath} onRemove={onRemove} />
          ))}
        </div>
      ) : (
        <EmptyPathPlaceholder />
      )}
    </Field>
  );
}

function AutoIgnoreFoldersField({
  cfg,
  updateConfig,
  setConfirmDisableDefaultExcludesOpen,
}: {
  cfg: LocalConfig;
  updateConfig: (next: LocalConfig) => void;
  setConfirmDisableDefaultExcludesOpen: (open: boolean) => void;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const segments = cfg.defaultFolderExcludeSegments;

  function updateSegments(next: string[]) {
    updateConfig({
      ...cfg,
      defaultFolderExcludeSegments: normalizeExcludeSegments(next),
    });
  }

  function addDraft() {
    const next = normalizeExcludeSegments([...segments, draft]);
    setDraft("");
    updateConfig({
      ...cfg,
      useDefaultFolderExcludes: true,
      defaultFolderExcludeSegments: next,
    });
  }

  return (
    <Field className="gap-2">
      <div className="flex items-center justify-between gap-3">
        <FieldContent>
          <FieldLabel htmlFor="default-excludes">
            Skip Dependency Folders
          </FieldLabel>
          <FieldDescription>
            {segments.length} folder name{segments.length === 1 ? "" : "s"}{" "}
            skipped automatically.
          </FieldDescription>
        </FieldContent>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? "Done" : "Edit"}
          </Button>
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
            aria-label="Skip dependency folders"
          />
        </div>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/10 p-2">
          <div className="flex flex-wrap gap-1.5">
            {segments.map((segment) => (
              <span
                key={segment}
                className="inline-flex h-7 items-center gap-1.5 rounded-md bg-muted/45 px-2.5 text-xs text-foreground/85"
              >
                {segment}
                <button
                  type="button"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={`Remove ${segment}`}
                  onClick={() =>
                    updateSegments(
                      segments.filter((value) => value !== segment),
                    )
                  }
                >
                  <HugeIcon
                    icon={Cancel01Icon}
                    className="size-3"
                    aria-hidden
                  />
                </button>
              </span>
            ))}
          </div>

          <div className="flex max-w-sm gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDraft();
                }
              }}
              placeholder="Folder name"
              className="h-7 text-xs"
              aria-label="Folder name to auto-ignore"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addDraft}
            >
              Add
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() =>
                updateSegments([...DEFAULT_FOLDER_EXCLUDE_SEGMENTS])
              }
            >
              Reset
            </Button>
          </div>
        </div>
      ) : null}
    </Field>
  );
}

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
    <FieldGroup className="gap-3">
      <PathSection
        label="Include Folders"
        paths={cfg.include}
        homePath={homePath}
        addLabel="Add Folder"
        onRemove={prepareRemoveIncludeFolder}
        onAdd={async () => {
          const dir = await pickFolder("Add Include Folder");
          if (!dir) return;
          const nextIncludes = collapseIncludeFolders([...cfg.include, dir]);
          if (nextIncludes.length === cfg.include.length) return;
          await prepareAddIncludeFolder(dir);
        }}
      />

      <PathSection
        label="Exclude Folders"
        paths={cfg.exclude}
        homePath={homePath}
        addLabel="Add Exclude"
        onRemove={(p) =>
          updateConfig({
            ...cfg,
            exclude: cfg.exclude.filter((x) => x !== p),
          })
        }
        onAdd={async () => {
          const dir = await pickFolder("Add Exclude Folder");
          if (!dir || cfg.exclude.includes(dir)) return;
          updateConfig({
            ...cfg,
            exclude: [...cfg.exclude, dir],
          });
        }}
      />

      <AutoIgnoreFoldersField
        cfg={cfg}
        updateConfig={updateConfig}
        setConfirmDisableDefaultExcludesOpen={
          setConfirmDisableDefaultExcludesOpen
        }
      />
    </FieldGroup>
  );
}
