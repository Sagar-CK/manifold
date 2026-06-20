import fsSync from "node:fs";
import { ipcMain } from "electron";
import {
  qdrantDockerQuickStartAvailable,
  sleep,
  startQdrantDockerContainer,
} from "../docker-compose.js";
import { embedQueryTextCached, readGeminiApiKeyOrThrow } from "../gemini-api.js";
import * as q from "../qdrant.js";
import { type IpcContext, unwrapArgs } from "./context.js";

export function registerQdrantHandlers(ctx: IpcContext): void {
  ipcMain.handle("qdrant_status", async () => {
    await q.ensureStarted();
    return q.qdrantStatus();
  });

  ipcMain.handle("qdrant_docker_quick_start_available", async () => {
    return qdrantDockerQuickStartAvailable();
  });

  ipcMain.handle("qdrant_start_docker", async () => {
    const result = await startQdrantDockerContainer();
    q.resetQdrantConnectionCache();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        await q.qdrantStatus();
        return result;
      } catch {
        await sleep(1000);
      }
    }
    throw new Error(
      "Qdrant container started but did not become ready. Check Docker logs.",
    );
  });

  ipcMain.handle("qdrant_upsert_metadata", async (_e, payload) => {
    const args = unwrapArgs<{
      sourceId: string;
      path: string;
      contentHash: string;
    }>(payload);
    await q.ensureStarted();
    return q.upsertMetadata(q.getClient(), args);
  });

  ipcMain.handle("qdrant_upsert_embedding", async (_e, payload) => {
    const args = unwrapArgs<q.UpsertEmbeddingArgs>(payload);
    await q.ensureStarted();
    const client = q.getClient();
    const pt = await q.buildContentPoint(client, args);
    await q.upsertContentPointsBatch(client, [pt]);
  });

  ipcMain.handle("qdrant_semantic_search", async (_e, payload) => {
    const args = unwrapArgs<{
      sourceId: string;
      queryVector: number[];
      limit?: number;
      channel?: string;
    }>(payload);
    await q.ensureStarted();
    const ch =
      args.channel?.toLowerCase() === "metadata" ? "metadata" : "content";
    return q.semanticSearch(q.getClient(), {
      sourceId: args.sourceId,
      queryVector: args.queryVector,
      limit: args.limit,
      channel: ch,
    });
  });

  ipcMain.handle("qdrant_similar_by_path", async (_e, payload) => {
    const args = unwrapArgs<{
      sourceId: string;
      path: string;
      limit?: number;
    }>(payload);
    await q.ensureStarted();
    return q.similarByPath(q.getClient(), args);
  });

  ipcMain.handle("hybrid_search", async (_e, payload) => {
    const args = unwrapArgs<{
      sourceId: string;
      queryText: string;
      limit?: number;
      searchTypes: string[];
    }>(payload);
    const semanticLimit = Math.min(Math.max(args.limit ?? 24, 1), 256);
    let includeTextSearch = true;
    let includeOcrSearch = true;
    let includeSemantic = true;
    if (args.searchTypes?.length) {
      const set = new Set(args.searchTypes.map((t) => t.trim().toLowerCase()));
      includeTextSearch = set.has("text");
      includeOcrSearch = set.has("ocr");
      includeSemantic = set.has("semantic");
    }

    type Hit = {
      score: number;
      matchType: string;
      file: { path: string; contentHash: string };
    };
    const out: Hit[] = [];
    const seen = new Set<string>();

    if (includeTextSearch || includeOcrSearch) {
      const direct = await ctx.textIndex.searchText(ctx.ud(), {
        sourceId: args.sourceId,
        query: args.queryText,
        limit: 256,
        includeText: includeTextSearch,
        includeOcr: includeOcrSearch,
      });
      for (const h of direct) {
        if (!seen.has(h.path)) {
          seen.add(h.path);
          out.push({
            score: 1,
            matchType: h.matchType,
            file: { path: h.path, contentHash: h.contentHash },
          });
        }
      }
    }

    if (includeSemantic) {
      await q.ensureStarted();
      const apiKey = await readGeminiApiKeyOrThrow();
      const qv = await embedQueryTextCached(apiKey, args.queryText);
      const contentHits = await q.semanticSearch(q.getClient(), {
        sourceId: args.sourceId,
        queryVector: qv,
        limit: semanticLimit,
        channel: "content",
      });
      let semanticAdded = 0;
      for (const h of contentHits) {
        if (!seen.has(h.file.path)) {
          seen.add(h.file.path);
          out.push({
            score: h.score,
            matchType: "semantic",
            file: h.file,
          });
          semanticAdded += 1;
          if (semanticAdded >= semanticLimit) break;
        }
      }
    }

    return out;
  });

  ipcMain.handle("qdrant_count_points", async (_e, payload) => {
    const args = unwrapArgs<{ sourceId: string }>(payload);
    await q.ensureStarted();
    return q.countPoints(q.getClient(), args.sourceId);
  });

  ipcMain.handle("qdrant_scroll_graph", async (_e, payload) => {
    const args = unwrapArgs<q.ScrollGraphArgs>(payload);
    await q.ensureStarted();
    const client = q.getClient();
    const { result, stalePaths } = await q.scrollGraph(client, args);
    if (stalePaths.length > 0) {
      await q.deletePointsForPaths(client, args.sourceId, stalePaths);
      await ctx.textIndex.deleteForPaths(ctx.ud(), args.sourceId, stalePaths);
    }
    return result;
  });

  ipcMain.handle("qdrant_set_path_tag_ids", async (_e, payload) => {
    const args = unwrapArgs<{
      sourceId: string;
      path: string;
      tagIds: string[];
    }>(payload);
    await q.ensureStarted();
    await q.setPathTagIds(q.getClient(), args);
  });

  ipcMain.handle("qdrant_delete_all_points", async (_e, payload) => {
    const args = unwrapArgs<{ sourceId: string }>(payload);
    await q.ensureStarted();
    await q.deleteAllPoints(q.getClient(), args.sourceId);
    await ctx.textIndex.deleteAllForSource(ctx.ud(), args.sourceId);
  });

  ipcMain.handle("qdrant_delete_points_for_paths", async (_e, payload) => {
    const args = unwrapArgs<{ sourceId: string; paths: string[] }>(payload);
    await q.ensureStarted();
    const res = await q.deletePointsForPaths(
      q.getClient(),
      args.sourceId,
      args.paths,
    );
    await ctx.textIndex.deleteForPaths(ctx.ud(), args.sourceId, args.paths);
    return res;
  });

  ipcMain.handle("prune_missing_indexed_paths", async (_e, payload) => {
    const args = unwrapArgs<{ sourceId: string; paths: string[] }>(payload);
    const sourceId = args.sourceId;
    const seen = new Set<string>();
    const unique = args.paths.filter((p) => {
      if (seen.has(p)) return false;
      seen.add(p);
      return true;
    });
    const removedPaths = unique.filter((p) => !fsSync.existsSync(p));
    if (removedPaths.length === 0) return { removedPaths: [] };
    await q.ensureStarted();
    await q.deletePointsForPaths(q.getClient(), sourceId, removedPaths);
    await ctx.textIndex.deleteForPaths(ctx.ud(), sourceId, removedPaths);
    return { removedPaths };
  });

  ipcMain.handle(
    "qdrant_delete_points_for_include_path",
    async (_e, payload) => {
      const args = unwrapArgs<{ sourceId: string; includePath: string }>(
        payload,
      );
      await q.ensureStarted();
      const client = q.getClient();
      const paths = await q.pathsUnderIncludeRoot(
        client,
        args.sourceId,
        args.includePath,
      );
      const res =
        paths.length === 0
          ? { deletedCount: 0 }
          : await q.deletePointsForPaths(client, args.sourceId, paths);
      await ctx.textIndex.deleteForPathsUnderInclude(
        ctx.ud(),
        args.sourceId,
        args.includePath,
      );
      return res;
    },
  );
}
