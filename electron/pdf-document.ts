import { getPdfjsNodeDocumentInit } from "./pdfjs-document-init.js";
import { importPdfjsLegacy } from "./pdfjs-import.js";

export {
  averageEmbeddings,
  GEMINI_PDF_CHUNK_PAGES,
  GEMINI_PDF_MAX_PAGES,
  isGeminiPdfPageLimitError,
  splitPdfBytes,
} from "./pdf-split.js";

export async function getPdfPageCount(bytes: Uint8Array): Promise<number> {
  const pdfjs = await importPdfjsLegacy();
  const doc = await pdfjs.getDocument({
    ...getPdfjsNodeDocumentInit(),
    data: bytes,
    useSystemFonts: true,
  }).promise;
  return doc.numPages;
}

/** Extract plain text from a 1-indexed inclusive page range (pdf.js). */
export async function extractPdfTextPageRange(
  bytes: Uint8Array,
  startPage: number,
  endPage: number,
  maxChars = 256 * 1024,
): Promise<string> {
  const pdfjs = await importPdfjsLegacy();
  const doc = await pdfjs.getDocument({
    ...getPdfjsNodeDocumentInit(),
    data: bytes,
    useSystemFonts: true,
  }).promise;
  const start = Math.max(1, startPage);
  const end = Math.min(endPage, doc.numPages);
  let out = "";
  for (let i = start; i <= end; i++) {
    if (out.length >= maxChars) break;
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const pageText = tc.items
      .map((it) => ("str" in it ? (it as { str: string }).str : ""))
      .join(" ");
    if (!pageText.trim()) continue;
    if (out) out += "\n";
    const remain = maxChars - out.length;
    out += pageText.length <= remain ? pageText : pageText.slice(0, remain);
  }
  return out;
}

export async function extractPdfTextAllPages(
  bytes: Uint8Array,
  maxChars = 512 * 1024,
): Promise<string> {
  const pageCount = await getPdfPageCount(bytes);
  return extractPdfTextPageRange(bytes, 1, pageCount, maxChars);
}
