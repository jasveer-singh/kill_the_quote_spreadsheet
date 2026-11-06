import path from "node:path";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export interface RawContent {
  source: "xlsx" | "pdf" | "docx" | "png" | "txt";
  /** Extracted text; null for images, which go to Claude as pixels. */
  text: string | null;
  image?: { mediaType: ImageMediaType; base64: string };
  /** Set when a PDF has image-only pages: the whole PDF is sent to Claude's vision input alongside any text. */
  pdfBase64?: string;
  imageOnlyPages: number[];
}

/** A PDF page with fewer extracted characters than this is treated as image-only. */
const IMAGE_ONLY_PAGE_CHARS = 20;

const IMAGE_TYPES: Record<string, ImageMediaType> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

async function readXlsx(data: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const out: string[] = [];
  wb.eachSheet((ws) => {
    out.push(`## Sheet: ${ws.name}`);
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: string[] = [];
      for (let c = 1; c <= row.cellCount; c++) cells.push(row.getCell(c).text.trim());
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      if (cells.length) out.push(`Row ${rowNumber}: ${cells.join(" | ")}`);
    });
  });
  return out.join("\n");
}

async function readPdf(data: Buffer): Promise<Pick<RawContent, "text" | "pdfBase64" | "imageOnlyPages">> {
  const parser = new PDFParse({ data: new Uint8Array(data) });
  try {
    const result = await parser.getText();
    const imageOnlyPages = result.pages.filter((p) => p.text.trim().length < IMAGE_ONLY_PAGE_CHARS).map((p) => p.num);
    const text = result.pages.map((p) => `--- Page ${p.num} ---\n${p.text.trim()}`).join("\n\n");
    return {
      text,
      imageOnlyPages,
      pdfBase64: imageOnlyPages.length ? data.toString("base64") : undefined,
    };
  } finally {
    await parser.destroy();
  }
}

/** Extracts the raw content of a vendor file without interpreting it. */
export async function loadRawContent(fileName: string, data: Buffer): Promise<RawContent> {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".xlsx") return { source: "xlsx", text: await readXlsx(data), imageOnlyPages: [] };
  if (ext === ".pdf") return { source: "pdf", ...(await readPdf(data)) };
  if (ext === ".docx") {
    const { value } = await mammoth.extractRawText({ buffer: data });
    return { source: "docx", text: value, imageOnlyPages: [] };
  }
  if (ext in IMAGE_TYPES) {
    return {
      source: "png",
      text: null,
      image: { mediaType: IMAGE_TYPES[ext], base64: data.toString("base64") },
      imageOnlyPages: [],
    };
  }
  if (ext === ".txt") return { source: "txt", text: data.toString("utf8"), imageOnlyPages: [] };
  throw new Error(`Unsupported vendor file type: ${ext || fileName}`);
}
