import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const port = Number(process.env.WORKEVA_TEST_PORT || 3111),
  base = `http://127.0.0.1:${port}`,
  dir = `.data/api-qa/${Date.now()}`;
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
async function request(path, user = "publisher", body) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      "x-workeva-user": user,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  return { status: r.status, data };
}
async function state() {
  const r = await request("/api/state");
  assert.equal(r.status, 200);
  return r.data;
}
async function command(user, cmd, status = 200) {
  const r = await request("/api/commands", user, cmd);
  assert.equal(r.status, status, JSON.stringify({ cmd, result: r }));
  return r.data.result;
}
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    if (i === 99) throw Error(logs);
    await new Promise((r) => setTimeout(r, 300));
  }
  let s = await state();
  await command(
    "publisher",
    {
      type: "signReview",
      assignmentId: "review-al",
      expectedRevision: 0,
      idempotencyKey: "forbidden",
    },
    403,
  );
  await command(
    "avery",
    {
      type: "saveResponse",
      assignmentId: "review-tn",
      metricId: "loans",
      answer: "OKAY",
      comment: "",
      expectedRevision: 0,
    },
    403,
  );
  for (const assignment of s.assignments) {
    let a = assignment;
    for (const metric of s.versions[0].sections.find(
      (x) => x.id === a.sectionId,
    ).metrics)
      a = await command(a.reviewerId, {
        type: "saveResponse",
        assignmentId: a.id,
        metricId: metric.id,
        answer: "OKAY",
        comment: "",
        expectedRevision: a.revision,
      });
    const sign = {
      type: "signReview",
      assignmentId: a.id,
      expectedRevision: a.revision,
      idempotencyKey: `sign-${a.id}`,
    };
    const first = await command(a.reviewerId, sign);
    const again = await command(a.reviewerId, sign);
    assert.equal(first.id, again.id);
  }
  s = await state();
  let pkg = s.packages[0];
  await command("publisher", {
    type: "finalizePackage",
    packageId: pkg.id,
    expectedRevision: pkg.revision,
  });
  const template = s.templates[0];
  await command(
    "publisher",
    {
      type: "saveTemplate",
      templateId: template.id,
      name: template.name,
      nodes: template.nodes,
      edges: [
        ...template.edges,
        {
          id: "cycle",
          source: "release",
          target: "entries",
          hard: true,
          lag: 0,
        },
      ],
      expectedRevision: template.revision,
    },
    422,
  );
  await command("publisher", {
    type: "publishTemplate",
    templateId: template.id,
    expectedRevision: template.revision,
  });
  let run = await command("publisher", {
    type: "createRun",
    templateId: template.id,
    period: "2026-08",
  });
  for (const title of [
    "Journal entries complete",
    "Profitability and FTP ready",
    "BLR published and validated",
    "Financial reviews signed",
    "Senior finance sign-off",
  ]) {
    for (const action of title === "Financial reviews signed"
      ? ["attest"]
      : ["start", "submit", "attest"]) {
      s = await state();
      run = s.runs.find((r) => r.id === run.id);
      const task = run.tasks.find((t) => t.title === title);
      await command("publisher", {
        type: "taskAction",
        runId: run.id,
        taskId: task.id,
        action,
        expectedRevision: task.revision,
        ...(action === "attest" ? { idempotencyKey: `attest-${task.id}` } : {}),
      });
    }
  }
  s = await state();
  const oldReleaseSignature = s.runs[0].tasks.find(
    (t) => t.title === "Senior finance sign-off",
  ).signatureId;
  pkg = s.packages[0];
  const pdf = await fetch(base + "/api/files/sample-blr", {
    headers: { "x-workeva-user": "publisher" },
  });
  assert.equal(pdf.status, 200);
  const form = new FormData();
  form.append("entity", "BANK");
  form.append(
    "file",
    new Blob([await pdf.arrayBuffer()], { type: "application/pdf" }),
    "replacement.pdf",
  );
  const uploaded = await fetch(base + "/api/files", {
    method: "POST",
    headers: { "x-workeva-user": "publisher" },
    body: form,
  });
  assert.equal(uploaded.status, 201);
  const evidence = await uploaded.json();
  const version = await command("publisher", {
    type: "addVersion",
    packageId: pkg.id,
    fileId: evidence.id,
    sections: s.versions[0].sections,
    producedAt: new Date().toISOString(),
    expectedRevision: pkg.revision,
  });
  await command("publisher", {
    type: "publishVersion",
    versionId: version.id,
    expectedRevision: version.revision,
  });
  s = await state();
  assert.equal(s.packages[0].finalVersionId, undefined);
  assert(
    s.assignments
      .filter((a) => a.versionId === version.id)
      .every((a) => !a.signatureId && a.responses.length === 0),
  );
  const release = s.runs[0].tasks.find(
    (t) => t.title === "Senior finance sign-off",
  );
  assert.equal(release.invalidated, true);
  assert(s.signatureEvents.some((e) => e.signatureId === oldReleaseSignature));
  const manifest = await request("/api/export?packageId=" + pkg.id);
  assert.equal(manifest.status, 200);
  assert.equal(manifest.data.document.id, version.id);
  await writeFile(
    `${dir}/result.json`,
    JSON.stringify(
      {
        passed: true,
        checks: [
          "unauthorized signing",
          "cross-entity writes",
          "idempotent signing",
          "finalization",
          "cycle rejection",
          "workflow attestations",
          "PDF upload",
          "replacement invalidation",
          "version-specific export",
        ],
      },
      null,
      2,
    ),
  );
  console.log("API journeys passed: " + dir);
} catch (e) {
  console.error(e);
  console.error(logs.slice(-4000));
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
}
