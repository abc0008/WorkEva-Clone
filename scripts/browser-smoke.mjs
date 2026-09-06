import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
const port = Number(process.env.WORKEVA_TEST_PORT || 3110);
const base = `http://127.0.0.1:${port}`;
const dir = process.env.WORKEVA_QA_DIR || `.data/qa/${Date.now()}`;
await mkdir(dir, { recursive: true });
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    env: {
      ...process.env,
      WORKEVA_LOCAL_MODE: "true",
      WORKEVA_BASE_URL: base,
      WORKEVA_STATE_FILE: `${dir}/state.json`,
      WORKEVA_FILE_DIR: `${dir}/files`,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
server.stdout.on("data", (d) => (logs += d));
server.stderr.on("data", (d) => (logs += d));
let browser;
let page;
try {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) break;
    } catch {}
    if (i === 99) throw new Error("Server did not start: " + logs);
    await new Promise((r) => setTimeout(r, 300));
  }
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page
    .getByRole("heading", { name: "My reviews", exact: true })
    .waitFor();
  const doc = await page.request.get(`${base}/api/files/sample-blr`);
  if (doc.status() !== 200)
    throw new Error(
      "Sample PDF failed: " + doc.status() + " " + (await doc.text()),
    );
  await page.getByRole("img", { name: "PDF page 1", exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelector('[aria-busy="false"] canvas')?.height > 100,
  );
  await page.screenshot({ path: `${dir}/review.png`, fullPage: true });
  const okay = page.getByRole("button", { name: "Okay", exact: true });
  for (let i = 0; i < (await okay.count()); i++) await okay.nth(i).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Sign off", exact: true }).click();
  await page.getByText("Review signed successfully", { exact: true }).waitFor();
  const state = await (await page.request.get(`${base}/api/state`)).json();
  if (state.assignments[0].status !== "SIGNED")
    throw new Error("Signature did not persist");
  await page.getByLabel("Development persona").selectOption("publisher");
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await page.getByRole("heading", { name: "Documents", exact: true }).waitFor();
  await page.screenshot({ path: `${dir}/documents.png`, fullPage: true });
  await page
    .getByRole("button", { name: "Workflow designer", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Workflow designer", exact: true })
    .waitFor();
  await page.locator(".react-flow__node").first().waitFor();
  await page.screenshot({ path: `${dir}/designer.png`, fullPage: true });
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByText("Template published", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Workflow runs", exact: true })
    .click();
  await page.getByRole("button", { name: "New run", exact: true }).click();
  await page.getByText("Workflow run created", { exact: true }).waitFor();
  const firstTask = page.locator(".we-task-row").first();
  await firstTask.getByRole("button", { name: "Start", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await firstTask.getByRole("button", { name: "Submit", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await firstTask.getByRole("button", { name: "Attest", exact: true }).click();
  await page.getByRole("dialog").getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Confirm attestation", exact: true })
    .click();
  await firstTask.getByText("COMPLETE", { exact: true }).waitFor();
  await page.screenshot({ path: `${dir}/run.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${dir}/mobile.png`, fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  await writeFile(
    `${dir}/result.json`,
    JSON.stringify(
      {
        errors,
        overflow,
        signaturePersisted: true,
        viewport: [1536, 1024],
        mobile: [390, 844],
      },
      null,
      2,
    ),
  );
  if (overflow) throw new Error("Mobile page overflows viewport");
  if (errors.length) throw new Error("Browser errors: " + errors.join("; "));
  console.log(
    JSON.stringify(
      { qaDirectory: dir, signaturePersisted: true, overflow, errors },
      null,
      2,
    ),
  );
} catch (e) {
  if (page)
    await page
      .screenshot({ path: `${dir}/failure.png`, fullPage: true })
      .catch(() => {});
  console.error(e);
  console.error(logs.slice(-6000));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
