import pdfWorkerSrc from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { useCallback, useEffect, useRef, useState } from "react";
import { readFileBase64 } from "@/lib/api/desktop";
import { normalizeForMatch } from "@/lib/search/textMatchNormalize";

/** pdf.js VerbosityLevel.ERRORS — hides benign font warnings like "TT: undefined function: 32". */
const PDFJS_VERBOSITY_ERRORS = 0;

import { AppAlert } from "@/components/app/AppAlert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

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
  const e = m[4]!;
  const f = m[5]!;
  const width = Math.max(1, item.width);
  const height = Math.max(1, item.height ?? Math.abs(m[3] ?? 0));
  return [e, f, e + width, f + height];
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

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function matchedTermRectsForItem(
  item: TextItemish,
  queryTerms: Set<string>,
): Array<[number, number, number, number]> {
  const text = item.str;
  if (!text.trim()) return [];

  const lower = text.toLowerCase();
  const terms = Array.from(queryTerms).filter((term) => term.length > 0);
  const [x1, y1, x2, y2] = itemToPdfRect(item);
  const width = Math.max(0, x2 - x1);
  if (width <= 0) return [];

  const rects: Array<[number, number, number, number]> = [];
  for (const term of terms) {
    let from = 0;
    while (from < lower.length) {
      const start = lower.indexOf(term, from);
      if (start === -1) break;
      const end = start + term.length;
      const itemHeight = Math.max(1, Math.abs(y2 - y1));
      const estimatedTermWidth = itemHeight * Math.max(1, term.length) * 0.72;
      const left = x1 + width * (start / text.length);
      const proportionalRight = x1 + width * (end / text.length);
      const right = Math.min(proportionalRight, left + estimatedTermWidth);
      rects.push([left, y1, right, y2]);
      from = end;
    }
  }
  return rects;
}

export type PdfTextMatchPreviewProps = {
  filePath: string;
  searchQuery: string;
  matchKind: "text" | "ocr";
  className?: string;
  viewerClassName?: string;
};

export function PdfTextMatchPreview({
  filePath,
  searchQuery,
  matchKind,
  className,
  viewerClassName,
}: PdfTextMatchPreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstHighlightRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [phase, setPhase] = useState<
    "idle" | "loading" | "ready" | "error" | "skipped"
  >("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [showBackToHighlight, setShowBackToHighlight] = useState(false);
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
    setShowBackToHighlight(false);

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
        const rectsVp = items.flatMap((it) =>
          matchedTermRectsForItem(it, queryTermSet).map(([x1, y1, x2, y2]) => {
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
          }),
        );

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
        setPhase("ready");
        if (rectsVp.length === 0) {
          setMessage("No visible PDF text highlight found for this query.");
        } else if (!fullCoverage) {
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
      const scrollEl = scrollRef.current;
      const highlightEl = firstHighlightRef.current;
      if (scrollEl && highlightEl) {
        const top =
          highlightEl.offsetTop -
          scrollEl.clientHeight / 2 +
          highlightEl.clientHeight / 2;
        const left =
          highlightEl.offsetLeft -
          scrollEl.clientWidth / 2 +
          highlightEl.clientWidth / 2;
        scrollEl.scrollTo({
          top: Math.max(0, top),
          left: Math.max(0, left),
          behavior: "smooth",
        });
      }
      rootRef.current?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    if (phase !== "ready") return;
    jumpToHighlight();
  }, [phase, jumpToHighlight]);

  useEffect(() => {
    if (phase !== "ready") return;
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const viewer = scrollEl;

    function updateVisibility() {
      const highlightEl = firstHighlightRef.current;
      if (!highlightEl) {
        setShowBackToHighlight(false);
        return;
      }
      const highlightTop = highlightEl.offsetTop;
      const highlightBottom = highlightTop + highlightEl.clientHeight;
      const visibleTop = viewer.scrollTop;
      const visibleBottom = visibleTop + viewer.clientHeight;
      setShowBackToHighlight(
        highlightBottom < visibleTop + 16 || highlightTop > visibleBottom - 16,
      );
    }

    updateVisibility();
    viewer.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("resize", updateVisibility);
    return () => {
      viewer.removeEventListener("scroll", updateVisibility);
      window.removeEventListener("resize", updateVisibility);
    };
  }, [phase, highlights]);

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
      aria-label="PDF search match"
      className={cn(
        "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
    >
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
          "relative max-h-[min(48vh,34rem)] overflow-auto rounded-lg border border-border/50 bg-background",
          viewerClassName,
          phase !== "ready" || !viewportSize ? "min-h-[8rem]" : null,
        )}
      >
        {phase === "ready" ? (
          <Button
            type="button"
            variant="default"
            size="sm"
            className={cn(
              "sticky left-1/2 top-3 z-20 h-7 -translate-x-1/2 rounded-full bg-foreground px-3 text-xs text-background shadow-sm transition-opacity hover:bg-foreground/90",
              showBackToHighlight
                ? "opacity-100"
                : "pointer-events-none opacity-0",
            )}
            onClick={jumpToHighlight}
          >
            Back to highlight
          </Button>
        ) : null}
        <div
          className={cn(
            "relative inline-block min-w-0",
            phase === "ready" && "-mt-7",
          )}
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
              className="pointer-events-none absolute left-0 top-0 overflow-hidden"
              style={{
                width: viewportSize.w,
                height: viewportSize.h,
              }}
            >
              {highlights.map((r, i) => (
                <div
                  key={`${r.left}-${r.top}-${i}`}
                  ref={i === 0 ? firstHighlightRef : undefined}
                  className="absolute bg-amber-300/50"
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
