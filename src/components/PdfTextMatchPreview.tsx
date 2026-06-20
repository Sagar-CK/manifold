import pdfWorkerSrc from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { readFileBase64 } from "@/lib/api/desktop";
import { normalizeForMatch } from "@/lib/textMatchNormalize";

/** pdf.js VerbosityLevel.ERRORS — hides benign font warnings like "TT: undefined function: 32". */
const PDFJS_VERBOSITY_ERRORS = 0;
import { cn } from "@/lib/utils";
import { AppAlert } from "./AppAlert";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Spinner } from "./ui/spinner";

const PDF_PREVIEW_MAX_BYTES = 25 * 1024 * 1024;
const VIEWPORT_SCALE = 1.35;

let pdfWorkerSrcAssigned = false;

type TextItemish = {
  str: string;
  transform: number[];
  width: number;
  height?: number;
};

function isTextItem(it: unknown): it is TextItemish {
  return (
    typeof it === "object" &&
    it !== null &&
    "str" in it &&
    typeof (it as { str: unknown }).str === "string" &&
    "transform" in it &&
    Array.isArray((it as { transform: unknown }).transform) &&
    "width" in it &&
    typeof (it as { width: unknown }).width === "number"
  );
}

function itemToPdfRect(item: TextItemish): [number, number, number, number] {
  const m = item.transform;
  const a = m[0]!;
  const b = m[1]!;
  const c = m[2]!;
  const d = m[3]!;
  const e = m[4]!;
  const f = m[5]!;
  const w = item.width;
  const rawH = item.height ?? Math.hypot(c, d);
  const h = rawH > 1e-6 ? rawH : Math.hypot(c, d);
  const corners: [number, number][] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    const px = a * x + c * y + e;
    const py = b * x + d * y + f;
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }
  return [minX, minY, maxX, maxY];
}

function textItemsFromContent(tc: {
  items: readonly unknown[];
}): TextItemish[] {
  return tc.items.filter(isTextItem);
}

function pageWordSet(joined: string): Set<string> {
  return new Set(
    normalizeForMatch(joined)
      .split(/\s+/)
      .filter((s) => s.length > 0),
  );
}

async function pickTargetPageIndex(
  numPages: number,
  getPageJoined: (pageIndex0: number) => Promise<string>,
  queryTerms: readonly string[],
): Promise<{ page0: number; fullCoverage: boolean }> {
  const cum = new Set<string>();
  for (let i = 0; i < numPages; i++) {
    const joined = await getPageJoined(i);
    const words = pageWordSet(joined);
    for (const w of words) cum.add(w);
    if (queryTerms.every((t) => cum.has(t))) {
      return { page0: i, fullCoverage: true };
    }
  }
  let bestPage = 0;
  let bestScore = 0;
  for (let i = 0; i < numPages; i++) {
    const joined = await getPageJoined(i);
    const words = pageWordSet(joined);
    const score = queryTerms.filter((t) => words.has(t)).length;
    if (score > bestScore) {
      bestScore = score;
      bestPage = i;
    }
  }
  return { page0: bestPage, fullCoverage: bestScore === queryTerms.length };
}

function itemMatchesAnyTerm(
  item: TextItemish,
  queryTerms: Set<string>,
): boolean {
  const words = pageWordSet(item.str);
  for (const t of queryTerms) {
    if (words.has(t)) return true;
  }
  return false;
}

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export type PdfTextMatchPreviewProps = {
  filePath: string;
  searchQuery: string;
  matchKind: "text" | "ocr";
  className?: string;
};

export function PdfTextMatchPreview({
  filePath,
  searchQuery,
  matchKind,
  className,
}: PdfTextMatchPreviewProps) {
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstHighlightRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [phase, setPhase] = useState<
    "idle" | "loading" | "ready" | "error" | "skipped"
  >("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [pageLabel, setPageLabel] = useState<string>("");
  const [viewportSize, setViewportSize] = useState<{
    w: number;
    h: number;
  } | null>(null);
  const [highlights, setHighlights] = useState<
    Array<{ left: number; top: number; width: number; height: number }>
  >([]);

  useEffect(() => {
    const qNorm = normalizeForMatch(searchQuery);
    const queryTerms = qNorm.split(/\s+/).filter((t) => t.length > 0);
    if (queryTerms.length === 0) {
      setPhase("skipped");
      setMessage("Empty search query; PDF preview skipped.");
      return;
    }
    const queryTermSet = new Set(queryTerms);

    let cancelled = false;
    setPhase("loading");
    setMessage(null);
    setHighlights([]);
    setViewportSize(null);
    setPageLabel("");

    void (async () => {
      try {
        const { base64 } = await readFileBase64(
          filePath,
          PDF_PREVIEW_MAX_BYTES,
        );
        if (cancelled) return;

        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        if (!pdfWorkerSrcAssigned) {
          pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
          pdfWorkerSrcAssigned = true;
        }

        const data = base64ToUint8Array(base64);
        const loadingTask = pdfjs.getDocument({
          data,
          useSystemFonts: true,
          verbosity: PDFJS_VERBOSITY_ERRORS,
        });
        const doc = await loadingTask.promise;
        if (cancelled) {
          return;
        }

        const cache = new Map<number, string>();
        async function getPageJoined(page0: number): Promise<string> {
          const hit = cache.get(page0);
          if (hit !== undefined) return hit;
          const page = await doc.getPage(page0 + 1);
          const tc = await page.getTextContent();
          const joined = textItemsFromContent(tc)
            .map((it) => it.str)
            .join(" ");
          cache.set(page0, joined);
          return joined;
        }

        const { page0, fullCoverage } = await pickTargetPageIndex(
          doc.numPages,
          getPageJoined,
          queryTerms,
        );
        if (cancelled) {
          return;
        }

        const page = await doc.getPage(page0 + 1);
        const viewport = page.getViewport({ scale: VIEWPORT_SCALE });
        const tc = await page.getTextContent();
        const items = textItemsFromContent(tc);
        const matched = items.filter((it) =>
          itemMatchesAnyTerm(it, queryTermSet),
        );
        const rectsVp = matched.map((it) => {
          const [x1, y1, x2, y2] = itemToPdfRect(it);
          const [vx1, vy1, vx2, vy2] = viewport.convertToViewportRectangle([
            x1,
            y1,
            x2,
            y2,
          ]);
          const left = Math.min(vx1, vx2);
          const top = Math.min(vy1, vy2);
          const width = Math.abs(vx2 - vx1);
          const height = Math.abs(vy2 - vy1);
          return { left, top, width, height };
        });

        if (rectsVp.length === 0 && items.length > 0) {
          const union = items.reduce(
            (acc, it) => {
              const [x1, y1, x2, y2] = itemToPdfRect(it);
              return {
                x1: Math.min(acc.x1, x1),
                y1: Math.min(acc.y1, y1),
                x2: Math.max(acc.x2, x2),
                y2: Math.max(acc.y2, y2),
              };
            },
            { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity },
          );
          if (Number.isFinite(union.x1)) {
            const [vx1, vy1, vx2, vy2] = viewport.convertToViewportRectangle([
              union.x1,
              union.y1,
              union.x2,
              union.y2,
            ]);
            const left = Math.min(vx1, vx2);
            const top = Math.min(vy1, vy2);
            const width = Math.abs(vx2 - vx1);
            const height = Math.abs(vy2 - vy1);
            rectsVp.push({ left, top, width, height });
          }
        }

        const canvas = canvasRef.current;
        if (!canvas) {
          return;
        }
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setPhase("error");
          setMessage("Canvas is unavailable in this environment.");
          return;
        }
        const renderTask = page.render({
          canvas,
          canvasContext: ctx,
          viewport,
          intent: "display",
        });
        await renderTask.promise;
        if (cancelled) {
          return;
        }

        setViewportSize({ w: viewport.width, h: viewport.height });
        setHighlights(rectsVp);
        setPageLabel(`Page ${page0 + 1} of ${doc.numPages}`);
        setPhase("ready");
        if (!fullCoverage) {
          setMessage(
            matchKind === "ocr"
              ? "OCR match: the PDF text layer may not include all terms; showing the best-matching page."
              : "Some query terms may appear on other pages; showing the earliest page where the full query is matched cumulatively, or the strongest single-page match.",
          );
        }
      } catch (e) {
        if (!cancelled) {
          setPhase("error");
          setMessage(String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath, searchQuery, matchKind]);

  const jumpToHighlight = useCallback(() => {
    requestAnimationFrame(() => {
      (firstHighlightRef.current ?? scrollRef.current)?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
      rootRef.current?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    if (phase !== "ready") return;
    jumpToHighlight();
  }, [phase, jumpToHighlight]);

  if (phase === "skipped") {
    return (
      <div className={cn("rounded-xl border border-border/60 p-4", className)}>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="region"
      aria-labelledby={titleId}
      className={cn(
        "rounded-xl border border-border/60 bg-muted/10 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
    >
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Label id={titleId} className="app-section-title text-sm">
          Search match in PDF
        </Label>
        <div className="flex flex-wrap items-center gap-2">
          {pageLabel ? (
            <span className="text-xs text-muted-foreground">{pageLabel}</span>
          ) : null}
          {phase === "ready" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={jumpToHighlight}
            >
              Jump to highlight
            </Button>
          ) : null}
        </div>
      </div>
      {matchKind === "ocr" ? (
        <p className="mb-2 text-xs text-muted-foreground">
          This hit came from OCR. Highlights use the PDF text layer when present
          and may not line up with scanned content.
        </p>
      ) : null}

      {phase === "loading" ? (
        <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Loading PDF and locating matches…
        </div>
      ) : null}

      {phase === "error" ? (
        <AppAlert
          variant="inline"
          className="text-sm"
          message={message ?? "Failed to load PDF."}
        />
      ) : null}

      {phase === "ready" && message ? (
        <p className="mb-2 text-xs text-muted-foreground">{message}</p>
      ) : null}

      <div
        ref={scrollRef}
        className={cn(
          "max-h-[min(70vh,52rem)] overflow-auto rounded-lg border border-border/50 bg-background",
          phase !== "ready" || !viewportSize ? "min-h-[8rem]" : null,
        )}
      >
        <div
          className="relative inline-block min-w-0"
          style={
            viewportSize
              ? {
                  width: viewportSize.w,
                  height: viewportSize.h,
                }
              : undefined
          }
        >
          <canvas ref={canvasRef} className="block max-w-full" />
          {phase === "ready" && viewportSize ? (
            <div
              className="pointer-events-none absolute left-0 top-0"
              style={{
                width: viewportSize.w,
                height: viewportSize.h,
              }}
            >
              {highlights.map((r, i) => (
                <div
                  key={`${r.left}-${r.top}-${i}`}
                  ref={i === 0 ? firstHighlightRef : undefined}
                  className="absolute rounded-sm bg-amber-400/35 ring-1 ring-amber-500/50"
                  style={{
                    left: r.left,
                    top: r.top,
                    width: r.width,
                    height: r.height,
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
