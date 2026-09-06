import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile as fsReadFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import type { Evidence, Principal } from "@/lib/types";
import { DomainError, requireEntity } from "./domain";

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_PAGES = 200;
const PDF_MAGIC = Buffer.from("%PDF-");

function localFilesDir() {
  return process.env.WORKEVA_FILE_DIR || join(process.cwd(), ".data", "files");
}
function localMode() {
  return (
    process.env.WORKEVA_LOCAL_MODE === "true" &&
    process.env.NODE_ENV !== "production"
  );
}
function maxBytes() {
  return Number(process.env.WORKEVA_MAX_FILE_BYTES || DEFAULT_MAX_BYTES);
}
function maxPages() {
  return Number(process.env.WORKEVA_MAX_PAGES || DEFAULT_MAX_PAGES);
}
function safeFilename(filename: string) {
  const base = filename.trim().split(/[\\/]/).pop() || "document.pdf";
  if (base.length > 180 || !/^[\w .()\-]+\.pdf$/i.test(base))
    throw new DomainError(422, "Only a safe PDF filename is accepted.");
  return base;
}

async function validatePdf(bytes: Uint8Array) {
  if (
    bytes.byteLength < PDF_MAGIC.byteLength ||
    !Buffer.from(bytes.slice(0, PDF_MAGIC.byteLength)).equals(PDF_MAGIC)
  )
    throw new DomainError(422, "The uploaded file is not a PDF.");
  if (bytes.byteLength > maxBytes())
    throw new DomainError(
      413,
      `PDF exceeds the ${Math.floor(maxBytes() / 1024 / 1024)} MB limit.`,
    );
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, {
      updateMetadata: false,
      throwOnInvalidObject: true,
    });
  } catch {
    throw new DomainError(422, "The PDF could not be parsed.");
  }
  const pageCount = document.getPageCount();
  if (pageCount < 1 || pageCount > maxPages())
    throw new DomainError(
      422,
      `PDF must contain between 1 and ${maxPages()} pages.`,
    );
  return pageCount;
}

function evidencePath(id: string) {
  return join(localFilesDir(), `${id}.pdf`);
}
function safeEvidenceId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id);
}
function blobSettings() {
  const endpoint = process.env.AZURE_STORAGE_ACCOUNT_URL;
  const container = process.env.AZURE_STORAGE_CONTAINER || "evidence";
  if (!endpoint)
    throw new DomainError(503, "Azure Blob Storage is not configured.");
  if (!/^https:\/\//i.test(endpoint))
    throw new DomainError(503, "Azure Blob Storage endpoint must use HTTPS.");
  return { endpoint: endpoint.replace(/\/$/, ""), container };
}

export async function saveFile(
  bytes: Uint8Array,
  filename: string,
  actor: Principal,
  entity: string,
): Promise<Evidence> {
  requireEntity(actor, entity);
  const cleanFilename = safeFilename(filename);
  const pageCount = await validatePdf(bytes);
  const id = randomUUID();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const uploadedAt = new Date().toISOString();
  const evidence: Evidence = {
    id,
    filename: cleanFilename,
    sha256,
    pageCount,
    size: bytes.byteLength,
    contentType: "application/pdf",
    uploadedBy: actor.id,
    uploadedAt,
    scan: localMode() ? "LOCAL_ONLY" : "PENDING",
    entity,
  };
  if (localMode()) {
    await mkdir(localFilesDir(), { recursive: true });
    await writeFile(evidencePath(id), bytes, { mode: 0o600 });
    return evidence;
  }
  const { BlobServiceClient } = await import("@azure/storage-blob");
  const { DefaultAzureCredential } = await import("@azure/identity");
  const client = new BlobServiceClient(
    blobSettings().endpoint,
    new DefaultAzureCredential(),
  );
  const blob = client
    .getContainerClient(blobSettings().container)
    .getBlockBlobClient(`${id}/${cleanFilename}`);
  await blob.uploadData(bytes, {
    blobHTTPHeaders: { blobContentType: "application/pdf" },
    metadata: { sha256, uploadedBy: actor.id, entity, scan: "PENDING" },
  });
  return evidence;
}

export async function readFile(evidence: Evidence): Promise<Uint8Array> {
  // IDs are generated UUIDs in production and include the seeded `sample-blr`
  // fixture in local mode. Keep the check path-safe rather than assuming UUIDs.
  if (
    evidence.contentType !== "application/pdf" ||
    !safeEvidenceId(evidence.id)
  )
    throw new DomainError(422, "Evidence metadata is invalid.");
  try {
    if (safeFilename(evidence.filename) !== evidence.filename)
      throw new Error("path component");
  } catch {
    throw new DomainError(422, "Evidence metadata is invalid.");
  }
  if (localMode()) {
    try {
      const bytes = new Uint8Array(await fsReadFile(evidencePath(evidence.id)));
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== evidence.sha256)
        throw new DomainError(
          409,
          "Evidence hash does not match its metadata.",
        );
      return bytes;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(404, "Evidence file not found.");
    }
  }
  const { BlobServiceClient } = await import("@azure/storage-blob");
  const { DefaultAzureCredential } = await import("@azure/identity");
  const settings = blobSettings();
  const client = new BlobServiceClient(
    settings.endpoint,
    new DefaultAzureCredential(),
  );
  const blob = client
    .getContainerClient(settings.container)
    .getBlockBlobClient(`${evidence.id}/${evidence.filename}`);
  try {
    const response = await blob.download();
    const chunks: Buffer[] = [];
    for await (const chunk of response.readableStreamBody || [])
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    if (
      bytes.byteLength !== evidence.size ||
      createHash("sha256").update(bytes).digest("hex") !== evidence.sha256
    )
      throw new DomainError(409, "Evidence hash does not match its metadata.");
    return new Uint8Array(bytes);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(404, "Evidence file not found.");
  }
}

/** Generates the deterministic two-page pilot PDF only when the local seeded state needs it. */
export async function createSeedPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const [entity, page] of [
    ["AL", "Alabama"],
    ["TN", "Tennessee"],
  ] as const) {
    const p = pdf.addPage([612, 792]);
    p.drawText(`Business Line Review — ${page}`, { x: 48, y: 738, size: 17 });
    p.drawText(`Reporting unit ${entity}  |  Period August 2026`, {
      x: 48,
      y: 714,
      size: 10,
    });
    p.drawText("SYNTHETIC TRAINING FIXTURE — NOT PRODUCTION DATA", {
      x: 48,
      y: 688,
      size: 9,
    });
    p.drawRectangle({
      x: 48,
      y: 607,
      width: 516,
      height: 48,
      color: rgb(0.93, 0.96, 0.98),
    });
    p.drawText("Selected metric", { x: 62, y: 637, size: 10 });
    p.drawText("Current period", { x: 280, y: 637, size: 10 });
    p.drawText("Prior period", { x: 420, y: 637, size: 10 });
    [
      "Loans",
      "Deposits",
      "Net interest income",
      "Salary expense",
      "Other operating expense",
    ].forEach((label, i) => {
      const y = 607 - i * 38;
      p.drawText(label, { x: 62, y, size: 11 });
      p.drawText(["12,540", "14,322", "187", "(88)", "(71)"][i], {
        x: 280,
        y,
        size: 10,
      });
      p.drawText(["11,892", "13,760", "164", "(80)", "(66)"][i], {
        x: 420,
        y,
        size: 10,
      });
      p.drawLine({
        start: { x: 48, y: y - 8 },
        end: { x: 564, y: y - 8 },
        thickness: 0.5,
      });
    });
    p.drawText(
      "Illustrative figures in millions. All values are synthetic and for demonstration only.",
      { x: 48, y: 370, size: 9 },
    );
  }
  return pdf.save();
}

export async function ensureSeedPdf(evidence: Evidence): Promise<Evidence> {
  if (!localMode() || evidence.id !== "sample-blr") return evidence;
  const bytes = await createSeedPdf();
  const pageCount = await validatePdf(bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await mkdir(localFilesDir(), { recursive: true });
  await writeFile(evidencePath(evidence.id), bytes, { mode: 0o600 });
  return {
    ...evidence,
    sha256,
    pageCount,
    size: bytes.byteLength,
    scan: "LOCAL_ONLY",
  };
}

/** Verify a Defender/approved scanner tag without ever turning an absent tag into CLEAN. */
export async function verifyBlobScan(evidence: Evidence): Promise<Evidence> {
  if (localMode()) return evidence;
  if (!safeEvidenceId(evidence.id))
    throw new DomainError(422, "Evidence metadata is invalid.");
  try {
    if (safeFilename(evidence.filename) !== evidence.filename)
      throw new Error("path component");
  } catch {
    throw new DomainError(422, "Evidence metadata is invalid.");
  }
  const settings = blobSettings();
  const { BlobServiceClient } = await import("@azure/storage-blob");
  const { DefaultAzureCredential } = await import("@azure/identity");
  const blob = new BlobServiceClient(
    settings.endpoint,
    new DefaultAzureCredential(),
  )
    .getContainerClient(settings.container)
    .getBlockBlobClient(`${evidence.id}/${evidence.filename}`);
  try {
    const tags = await blob.getTags();
    // Defender for Storage has used both the documented display name and a
    // compact key over its rollout. An explicit override takes precedence;
    // unknown/missing values remain pending.
    const configured = process.env.WORKEVA_SCAN_TAG?.trim();
    const candidates = configured
      ? [configured, "Malware Scanning scan result", "MalwareScanResult"]
      : ["Malware Scanning scan result", "MalwareScanResult"];
    const value = candidates
      .map((key) => tags.tags[key])
      .find((item) => typeof item === "string" && item.trim())
      ?.trim()
      .toLowerCase();
    if (!value) return { ...evidence, scan: "PENDING" };
    if (
      ["clean", "no threats found", "no_threats_found", "no threats"].includes(
        value,
      )
    )
      return { ...evidence, scan: "CLEAN" };
    if (
      [
        "rejected",
        "quarantined",
        "malicious",
        "threat found",
        "threats found",
        "infected",
      ].includes(value)
    )
      return { ...evidence, scan: "REJECTED" };
    return { ...evidence, scan: "PENDING" };
  } catch {
    return { ...evidence, scan: "PENDING" };
  }
}
