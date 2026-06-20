import {
  Delete02Icon,
  Folder01Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { HugeIcon } from "@/components/ui/huge-icon";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { collapseIncludeFolders, type LocalConfig } from "@/lib/localConfig";
import { formatPathPartsForDisplay } from "@/lib/pathDisplay";

function PathRow({
  path,
  homePath,
  onRemove,
}: {
  path: string;
  homePath: string;
  onRemove: (path: string) => void;
}) {
  const { name, parent, display } = formatPathPartsForDisplay(path, homePath);

  return (
    <Item variant="outline" size="sm" className="min-w-0">
      <ItemMedia variant="icon" className="text-muted-foreground">
        <HugeIcon icon={Folder01Icon} aria-hidden />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <ItemTitle className="cursor-default font-mono font-normal">
              {name}
            </ItemTitle>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            className="max-w-sm text-left font-mono break-all"
          >
            {path === display ? (
              display
            ) : (
              <>
                <span className="block">{display}</span>
                <span className="mt-1 block opacity-70">{path}</span>
              </>
            )}
          </TooltipContent>
        </Tooltip>
        {parent ? (
          <ItemDescription className="truncate font-mono">
            {parent}
          </ItemDescription>
        ) : null}
      </ItemContent>
      <ItemActions>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={`Remove ${display}`}
              onClick={() => onRemove(path)}
            >
              <HugeIcon icon={Delete02Icon} aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Remove</TooltipContent>
        </Tooltip>
      </ItemActions>
    </Item>
  );
}

function PathSection({
  label,
  paths,
  homePath,
  emptyMessage,
  addLabel,
  onRemove,
  onAdd,
}: {
  label: string;
  paths: string[];
  homePath: string;
  emptyMessage: string;
  addLabel: string;
  onRemove: (path: string) => void;
  onAdd: () => void;
}) {
  return (
    <Field className="gap-3">
      <div className="flex items-center justify-between gap-3">
        <FieldLabel className="mb-0">{label}</FieldLabel>
        <Tooltip>
          <TooltipTrigger asChild>
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
          </TooltipTrigger>
          <TooltipContent side="left">{addLabel}</TooltipContent>
        </Tooltip>
      </div>

      {paths.length === 0 ? (
        <FieldDescription>{emptyMessage}</FieldDescription>
      ) : (
        <ItemGroup className="gap-2">
          {paths.map((p) => (
            <PathRow key={p} path={p} homePath={homePath} onRemove={onRemove} />
          ))}
        </ItemGroup>
      )}
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
    <FieldGroup>
      <FieldDescription>
        Choose folders to index and any paths to skip. Changes apply on the
        next scan.
      </FieldDescription>

      <PathSection
        label="Include folders"
        paths={cfg.include}
        homePath={homePath}
        emptyMessage="None yet."
        addLabel="Add folder"
        onRemove={prepareRemoveIncludeFolder}
        onAdd={async () => {
          const dir = await pickFolder("Add include folder");
          if (!dir) return;
          const nextIncludes = collapseIncludeFolders([...cfg.include, dir]);
          if (nextIncludes.length === cfg.include.length) return;
          await prepareAddIncludeFolder(dir);
        }}
      />

      <PathSection
        label="Exclude folders"
        paths={cfg.exclude}
        homePath={homePath}
        emptyMessage="None."
        addLabel="Add exclude"
        onRemove={(p) =>
          updateConfig({
            ...cfg,
            exclude: cfg.exclude.filter((x) => x !== p),
          })
        }
        onAdd={async () => {
          const dir = await pickFolder("Add exclude folder");
          if (!dir || cfg.exclude.includes(dir)) return;
          updateConfig({
            ...cfg,
            exclude: [...cfg.exclude, dir],
          });
        }}
      />

      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="default-excludes">
            Skip dependency folders
          </FieldLabel>
          <FieldDescription>
            node_modules, .git, dist, and similar.
          </FieldDescription>
        </FieldContent>
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
        />
      </Field>
    </FieldGroup>
  );
}
