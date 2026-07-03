import type { AppShortcutAction } from "@/lib/app/shortcuts";

type DesktopApi = {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>;
  subscribe: (channel: string, listener: (data: unknown) => void) => () => void;
};

const DESKTOP_API_UNAVAILABLE =
  "Manifold desktop API is unavailable. Open this app with Electron (pnpm dev).";

export class DesktopApiUnavailableError extends Error {
  constructor() {
    super(DESKTOP_API_UNAVAILABLE);
    this.name = "DesktopApiUnavailableError";
  }
}

export function isDesktopAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    !!(window as Window & { desktop?: DesktopApi }).desktop
  );
}

function getDesktop(): DesktopApi {
  const d = (window as Window & { desktop?: DesktopApi }).desktop;
  if (!d) {
    throw new DesktopApiUnavailableError();
  }
  return d;
}

async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  return getDesktop().invoke(channel, payload) as Promise<T>;
}

type Unlisten = () => void;

async function subscribe<T>(
  channel: string,
  onData: (payload: T) => void,
): Promise<Unlisten> {
  return getDesktop().subscribe(channel, (data) => {
    onData(data as T);
  });
}

export type EmbeddingJobPhase =
  | "idle"
  | "scanning"
  | "embedding"
  | "paused"
  | "cancelling"
  | "done"
  | "error";

export type EmbeddingJobStatus = {
  phase: EmbeddingJobPhase;
  processed: number;
  total: number;
  message: string;
};

export type EmbeddingFileFailure = {
  path: string;
  reason: string;
};

export type EmbeddingFileEmbedded = {
  path: string;
};

export type ScanArgs = {
  include: string[];
  exclude: string[];
  extensions: string[];
  useDefaultFolderExcludes: boolean;
  defaultFolderExcludeSegments?: string[];
};

export type VisionRasterOptionsPayload = {
  maxEdgePx: number;
  jpegQuality: number;
};

export type SearchHit = {
  score: number;
  matchType: "semantic" | "text" | "ocr";
  file: {
    path: string;
    contentHash: string;
  };
};

export type SimilarHit = {
  score: number;
  file: {
    path: string;
    contentHash: string;
  };
};

type GeminiApiKeySource = "appStorage" | "none";

export type GeminiApiKeyStatus = {
  configured: boolean;
  source: GeminiApiKeySource;
};

export type QdrantStatus = {
  baseUrl: string;
};

export type ScanFilesEstimateResult = {
  total: number | string;
  imageFiles: number | string;
  audioFiles: number | string;
  videoFiles: number | string;
  textLikeFiles: number | string;
};

export type GraphScrollResult = {
  points: Array<{ path: string; contentHash: string; tagIds: string[] }>;
  packedEmbeddingsF32Base64: string;
  n: number;
  d: number;
};

export type ThumbnailResult = {
  png_base64: string;
};

export type CountPointsResult = {
  count: number | string;
};

export async function getHomeDir(): Promise<string> {
  return await invoke<string>("app_get_home_dir");
}

export async function showOpenDirectoryDialog(options: {
  title?: string;
}): Promise<string | null> {
  return await invoke<string | null>("dialog_open_directory", {
    args: options,
  });
}

/** Returns empty string on success, or an error message from the OS. */
export async function shellOpenPath(targetPath: string): Promise<string> {
  return await invoke<string>("shell_open_path", {
    args: { path: targetPath },
  });
}

export async function qdrantStatus(): Promise<QdrantStatus> {
  return await invoke<QdrantStatus>("qdrant_status");
}

export async function startQdrantDocker(): Promise<{ message: string }> {
  return await invoke<{ message: string }>("qdrant_start_docker");
}

export async function openExternalUrl(url: string): Promise<void> {
  await invoke("shell_open_external", { args: { url } });
}

export async function cancelEmbeddingJob(): Promise<void> {
  await invoke("cancel_embedding_job");
}

export async function startEmbeddingJob(args: {
  scan: ScanArgs;
  sourceId: string;
  visionRaster: VisionRasterOptionsPayload;
}): Promise<void> {
  await invoke("start_embedding_job", { args });
}

export async function embeddingJobStatus(): Promise<EmbeddingJobStatus> {
  return await invoke<EmbeddingJobStatus>("embedding_job_status");
}

export async function saveGeminiApiKey(apiKey: string): Promise<void> {
  await invoke("save_gemini_api_key", { args: { apiKey } });
}

export async function clearStoredGeminiApiKey(): Promise<void> {
  await invoke("clear_stored_gemini_api_key");
}

export async function geminiApiKeyStatus(): Promise<GeminiApiKeyStatus> {
  return await invoke<GeminiApiKeyStatus>("gemini_api_key_status");
}

export async function hybridSearch(args: {
  sourceId: string;
  queryText: string;
  limit: number;
  searchTypes: string[];
}): Promise<SearchHit[]> {
  return await invoke<SearchHit[]>("hybrid_search", { args });
}

export async function textIndexFullTextForPath(
  sourceId: string,
  path: string,
): Promise<string | null> {
  return await invoke<string | null>("text_index_full_text_for_path", {
    args: { sourceId, path },
  });
}

/** Read entire file as base64 when within `maxBytes` (throws if larger). */
export async function readFileBase64(
  path: string,
  maxBytes: number,
): Promise<{ base64: string; sizeBytes: number }> {
  return await invoke<{ base64: string; sizeBytes: number }>(
    "read_file_base64",
    {
      args: { path, max_bytes: maxBytes },
    },
  );
}

export async function qdrantCountPoints(
  sourceId: string,
): Promise<CountPointsResult> {
  return await invoke<CountPointsResult>("qdrant_count_points", {
    args: { sourceId },
  });
}

export async function qdrantDeleteAllPoints(sourceId: string): Promise<void> {
  await invoke("qdrant_delete_all_points", { args: { sourceId } });
}

export async function qdrantDeletePointsForIncludePath(
  sourceId: string,
  includePath: string,
): Promise<void> {
  await invoke("qdrant_delete_points_for_include_path", {
    args: { sourceId, includePath },
  });
}

export async function qdrantDeletePointsForPaths(
  sourceId: string,
  paths: string[],
): Promise<void> {
  await invoke("qdrant_delete_points_for_paths", {
    args: { sourceId, paths },
  });
}

export async function pruneMissingIndexedPaths(
  sourceId: string,
  paths: string[],
): Promise<string[]> {
  const result = await invoke<{ removedPaths: string[] }>(
    "prune_missing_indexed_paths",
    {
      args: { sourceId, paths },
    },
  );
  return result.removedPaths;
}

export async function scanFilesEstimate(
  args: ScanArgs,
): Promise<ScanFilesEstimateResult> {
  return await invoke<ScanFilesEstimateResult>("scan_files_estimate", {
    args,
  });
}

export async function thumbnailImageBase64Png(
  path: string,
  maxEdge: number,
  page: number = 0,
): Promise<ThumbnailResult> {
  return await invoke<ThumbnailResult>("thumbnail_image_base64_png", {
    args: { path, max_edge: maxEdge, page },
  });
}

export async function qdrantSimilarByPath(
  sourceId: string,
  path: string,
  limit: number,
): Promise<SimilarHit[]> {
  return await invoke<SimilarHit[]>("qdrant_similar_by_path", {
    args: { sourceId, path, limit },
  });
}

export async function qdrantScrollGraph(args: {
  sourceId: string;
  limit: number;
  tagFilterIds?: string[];
}): Promise<GraphScrollResult> {
  return await invoke<GraphScrollResult>("qdrant_scroll_graph", { args });
}

export async function qdrantSetPathTagIds(
  sourceId: string,
  path: string,
  tagIds: string[],
): Promise<void> {
  await invoke("qdrant_set_path_tag_ids", {
    args: { sourceId, path, tagIds },
  });
}

export async function geminiJudgeTag(args: {
  sourceId: string;
  sourcePath: string;
  targetPath: string;
  tagName: string;
  similarityScore: number;
  visionRaster: VisionRasterOptionsPayload;
}): Promise<boolean> {
  return await invoke<boolean>("gemini_judge_tag", { args });
}

export async function subscribeEmbeddingStatus(
  onStatus: (status: EmbeddingJobStatus) => void,
): Promise<Unlisten> {
  return await subscribe<EmbeddingJobStatus>("embedding://status", onStatus);
}

export async function subscribeEmbeddingDone(
  onDone: () => void,
): Promise<Unlisten> {
  return await subscribe<unknown>("embedding://done", () => {
    onDone();
  });
}

export async function subscribeEmbeddingError(
  onError: (payload: { message: string }) => void,
): Promise<Unlisten> {
  return await subscribe<{ message: string }>("embedding://error", onError);
}

export async function subscribeAppShortcut(
  onShortcut: (action: AppShortcutAction) => void,
): Promise<Unlisten> {
  return await subscribe<{ action: AppShortcutAction }>(
    "app://shortcut",
    (payload) => {
      onShortcut(payload.action);
    },
  );
}

export async function subscribeEmbeddingFileFailed(
  onFailure: (failure: EmbeddingFileFailure) => void,
): Promise<Unlisten> {
  return await subscribe<EmbeddingFileFailure>(
    "embedding://file-failed",
    onFailure,
  );
}

export async function subscribeEmbeddingFileEmbedded(
  onEmbedded: (payload: EmbeddingFileEmbedded) => void,
): Promise<Unlisten> {
  return await subscribe<EmbeddingFileEmbedded>(
    "embedding://file-embedded",
    onEmbedded,
  );
}
