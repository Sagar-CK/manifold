import "./App.css";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { EnvIssuesBanner } from "./components/EnvIssuesBanner";
import { KeyboardShortcutsHelp } from "./components/KeyboardShortcutsHelp";
import { EmbeddingStatusProvider } from "./context/EmbeddingStatusContext";
import { useAppHealth } from "./hooks/useAppHealth";
import { useEmbeddingController } from "./hooks/useEmbeddingController";
import { subscribeAppShortcut } from "./lib/api/tauri";
import {
  type AppShortcutAction,
  SEARCH_QUERY_INPUT_ID,
} from "./lib/appShortcuts";
import type { SupportedExt } from "./lib/localConfig";
import { useConfigStore } from "./lib/stores/configStore";
import { cn } from "./lib/utils";
import { FileResultPage } from "./pages/FileResultPage";
import { ReviewTagsPage } from "./pages/ReviewTagsPage";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";

const GraphExplorerPage = lazy(async () => {
  const mod = await import("./pages/GraphExplorerPage");
  return { default: mod.GraphExplorerPage };
});

const EXT_OPTIONS: SupportedExt[] = [
  "png",
  "jpg",
  "jpeg",
  "pdf",
  "mp3",
  "wav",
  "mp4",
  "mov",
];

function focusSearchInput(attempt: number = 0) {
  const input = document.getElementById(SEARCH_QUERY_INPUT_ID);
  if (input instanceof HTMLInputElement) {
    input.focus();
    input.select();
    return;
  }
  if (attempt >= 10) return;
  window.setTimeout(() => focusSearchInput(attempt + 1), 50);
}

export default function RouterApp() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const pathnameRef = useRef(pathname);
  const graphLayout = pathname === "/graph";
  const [cfg, setCfg] = useConfigStore();
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const { envIssues } = useAppHealth();
  const {
    embedding,
    hasPendingEmbeds,
    embeddingPhase,
    embedProgress,
    lastEmbedError,
    embedFailures,
    cancelEmbedding,
    clearGeminiEmbedError,
    onGeminiApiKeySaved,
  } = useEmbeddingController(cfg);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void subscribeAppShortcut((action: AppShortcutAction) => {
      if (action === "show-shortcuts") {
        setShortcutsHelpOpen(true);
        return;
      }

      setShortcutsHelpOpen(false);

      if (action === "search") {
        if (pathnameRef.current !== "/") {
          navigate("/");
        }
        focusSearchInput();
        return;
      }

      if (action === "graph" && pathnameRef.current !== "/graph") {
        navigate("/graph");
        return;
      }

      if (action === "review-tags" && pathnameRef.current !== "/review-tags") {
        navigate("/review-tags");
        return;
      }

      if (action === "settings" && pathnameRef.current !== "/settings") {
        navigate("/settings");
      }
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
        return;
      }
      unlisten = nextUnlisten;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [navigate]);

  return (
    <main className="h-screen w-full overflow-hidden bg-background text-foreground">
      <div
        className={cn(
          "mx-auto flex h-full min-h-0 flex-col px-6 py-8",
          graphLayout ? "max-w-[min(100%,1400px)]" : "max-w-5xl",
        )}
      >
        <EnvIssuesBanner issues={envIssues} />
        <EmbeddingStatusProvider
          embedding={embedding}
          hasPendingEmbeds={hasPendingEmbeds}
          embeddingPhase={embeddingPhase}
          embedProgress={embedProgress}
          lastEmbedError={lastEmbedError}
          embedFailures={embedFailures}
          cancelEmbedding={cancelEmbedding}
        >
          <div className="flex min-h-0 flex-1 flex-col">
            <Routes>
              <Route path="/" element={<SearchPage cfg={cfg} />} />
              <Route path="/file" element={<FileResultPage cfg={cfg} />} />
              <Route
                path="/graph"
                element={
                  <Suspense
                    fallback={
                      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                        Loading graph…
                      </div>
                    }
                  >
                    <GraphExplorerPage cfg={cfg} />
                  </Suspense>
                }
              />
              <Route
                path="/settings"
                element={
                  <SettingsPage
                    cfg={cfg}
                    setCfg={setCfg}
                    extOptions={EXT_OPTIONS}
                    onGeminiApiKeySaved={onGeminiApiKeySaved}
                    onGeminiStoredKeyCleared={clearGeminiEmbedError}
                  />
                }
              />
              <Route
                path="/review-tags"
                element={<ReviewTagsPage sourceId={cfg.sourceId} />}
              />
            </Routes>
          </div>
        </EmbeddingStatusProvider>
      </div>
      <KeyboardShortcutsHelp
        open={shortcutsHelpOpen}
        onOpenChange={setShortcutsHelpOpen}
      />
    </main>
  );
}
