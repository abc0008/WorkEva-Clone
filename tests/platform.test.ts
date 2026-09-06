import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { getPrincipal, isLocalMode } from "@/server/auth";
import { saveFile, readFile } from "@/server/files";
import { processOutboxOnce } from "@/server/notifications";
import { readState, transact } from "@/server/store";
import type { Principal } from "@/lib/types";

const stateFile = join(process.cwd(), ".data", "platform-test-state.json");
const fileDir = join(process.cwd(), ".data", "platform-test-files");
const actor: Principal = {
  id: "avery",
  name: "Avery Morgan",
  email: "avery@example.invalid",
  roles: ["reviewer"],
  entities: ["AL"],
  active: true,
};

afterEach(async () => {
  delete process.env.WORKEVA_LOCAL_MODE;
  delete process.env.WORKEVA_STATE_FILE;
  delete process.env.WORKEVA_FILE_DIR;
  delete process.env.WORKEVA_NOTIFICATION_SEND;
  delete process.env.WORKEVA_NOTIFICATION_PROVIDER;
  await rm(stateFile, { force: true });
  await rm(`${stateFile}.lock`, { recursive: true, force: true });
  await rm(fileDir, { recursive: true, force: true });
});

async function pdf() {
  const doc = await PDFDocument.create();
  doc.addPage();
  return new Uint8Array(await doc.save());
}

describe("platform boundaries", () => {
  it("uses explicit local mode and durable revisions", async () => {
    process.env.WORKEVA_LOCAL_MODE = "true";
    process.env.WORKEVA_STATE_FILE = stateFile;
    process.env.WORKEVA_FILE_DIR = fileDir;
    expect(isLocalMode()).toBe(true);
    await transact((state) => {
      state.users.push(actor);
    });
    const state = await readState();
    expect(state.revision).toBe(1);
    expect(state.users[0].id).toBe("avery");
    const principal = await getPrincipal(
      new Request("http://localhost", {
        headers: { "x-workeva-user": "avery" },
      }),
    );
    expect(principal.id).toBe("avery");
  });

  it("validates PDF bytes, stores privately, and verifies hash on read", async () => {
    process.env.WORKEVA_LOCAL_MODE = "true";
    process.env.WORKEVA_STATE_FILE = stateFile;
    process.env.WORKEVA_FILE_DIR = fileDir;
    const evidence = await saveFile(await pdf(), "review.pdf", actor, "AL");
    expect(evidence.scan).toBe("LOCAL_ONLY");
    expect((await readFile(evidence)).byteLength).toBeGreaterThan(20);
    await expect(
      saveFile(
        new Uint8Array(Buffer.from("not a pdf")),
        "review.pdf",
        actor,
        "AL",
      ),
    ).rejects.toThrow(/not a PDF/);
  });

  it("records dry runs and never marks them sent", async () => {
    process.env.WORKEVA_LOCAL_MODE = "true";
    process.env.WORKEVA_STATE_FILE = stateFile;
    process.env.WORKEVA_FILE_DIR = fileDir;
    await transact((state) => {
      state.outbox.push({
        id: "event-1",
        type: "TASK_ASSIGNED",
        subjectId: "task",
        recipientId: "avery",
        message: "Review assigned",
        status: "PENDING",
        attempts: 0,
        createdAt: new Date().toISOString(),
      });
    });
    const result = await processOutboxOnce();
    expect(result.status).toBe("DRY_RUN");
    expect((await readState()).outbox[0].status).toBe("DRY_RUN");
  });
});
