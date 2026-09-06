import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { expect } from "@playwright/test";

// Runs inside the existing isolated browser smoke server and authenticated persona.
export async function workflowSourceJourney(page, base, dir) {
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page
    .getByRole("button", { name: "Workflow designer", exact: true })
    .click();
  const state = async () =>
    (await page.request.get(`${base}/api/state`)).json();
  const before = await state();
  const published = before.templates.find((t) => t.status === "PUBLISHED");
  assert.ok(published);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import file", exact: true }).click();
  await (await chooser).setFiles("examples/quarterly-certification.yaml");
  await page
    .getByText("Workflow imported as a new draft", { exact: true })
    .waitFor();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  const imported = (await state()).templates.find(
    (t) => t.name === "Quarterly certification",
  );
  assert.equal(imported.status, "DRAFT");
  assert.deepEqual(
    (await state()).templates.find((t) => t.id === published.id),
    published,
  );

  // Visual changes are included in the downloaded definition before saving.
  await page
    .getByRole("textbox", { name: "Node title", exact: true })
    .fill("Reviewed supporting schedules");
  const node = page.locator('.react-flow__node[data-id="prepare"]');
  const box = await node.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + 75, box.y + 24);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 74, { steps: 8 });
  await page.mouse.up();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const output = await download;
  const exported = JSON.parse(await readFile(await output.path(), "utf8"));
  assert.equal(exported.nodes[0].title, "Reviewed supporting schedules");
  assert.notDeepEqual(exported.nodes[0].position, imported.nodes[0].position);
  assert.deepEqual(exported.edges, imported.edges);

  // Invalid source must not mutate the graph. Cancel discarding unapplied text.
  const editor = page.getByRole("textbox", { name: "Workflow source editor" });
  await editor.fill("schemaVersion: [broken");
  await page.getByRole("button", { name: "Apply source", exact: true }).click();
  await expect(
    page.getByText(/Invalid workflow definition:/).first(),
  ).toBeVisible();
  await expect(node).toContainText("Reviewed supporting schedules");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByLabel("Workflow source format").selectOption("json");
  await expect(editor).toHaveValue("schemaVersion: [broken");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await expect(editor).toHaveValue("schemaVersion: [broken");
  await page.screenshot({
    path: `${dir}/workflow-source-error.png`,
    fullPage: true,
  });

  // Reimport the visual export into a distinct draft.
  page.once("dialog", (dialog) => dialog.accept());
  const chooser2 = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import file", exact: true }).click();
  await (
    await chooser2
  ).setFiles({
    name: "roundtrip.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(editor).toHaveValue(/Reviewed supporting schedules/);
  const after = await state();
  assert.equal(after.templates.length, before.templates.length + 2);
  const reimported = after.templates.find(
    (t) => t.id !== imported.id && t.name === imported.name,
  );
  assert.deepEqual(reimported.nodes, exported.nodes);
  assert.deepEqual(reimported.edges, exported.edges);
  assert.deepEqual(
    after.templates.find((t) => t.id === published.id),
    published,
  );

  // Applying source updates the name and graph, then persists through Save.
  exported.name = "Source authored certification";
  exported.nodes[1].title = "Approve quarterly results";
  await editor.fill(JSON.stringify(exported, null, 2));
  await page.getByRole("button", { name: "Apply source", exact: true }).click();
  await expect(
    page.locator('.react-flow__node[data-id="certify"]'),
  ).toContainText("Approve quarterly results");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Template saved", { exact: true })).toBeVisible();
  assert.ok((await state()).templates.some((t) => t.name === exported.name));
  await page.screenshot({ path: `${dir}/workflow-source.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `${dir}/workflow-source-mobile.png`,
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
  );
  return {
    importedYaml: true,
    visualJsonRoundTrip: true,
    invalidSourcePreservedGraph: true,
    publishedTemplatePreserved: true,
    sourceNameSaved: true,
  };
}
