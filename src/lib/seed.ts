import type { AppState, Metric, WorkflowNode } from "./types";
export function emptyState(): AppState {
  return {
    revision: 0,
    users: [],
    packages: [],
    versions: [],
    assignments: [],
    signatures: [],
    signatureEvents: [],
    comments: [],
    audit: [],
    outbox: [],
    templates: [],
    runs: [],
    evidence: [],
    idempotency: [],
  };
}
export function seedState(): AppState {
  const state = emptyState();
  state.users = [
    {
      id: "avery",
      name: "Avery Morgan",
      email: "avery@example.invalid",
      roles: ["reviewer"],
      entities: ["AL"],
      active: true,
    },
    {
      id: "jordan",
      name: "Jordan Lee",
      email: "jordan@example.invalid",
      roles: ["reviewer"],
      entities: ["TN"],
      active: true,
    },
    {
      id: "publisher",
      name: "Taylor Brooks",
      email: "taylor@example.invalid",
      roles: ["publisher", "manager", "designer", "reviewer"],
      entities: ["*"],
      active: true,
    },
    {
      id: "admin",
      name: "Casey Rivera",
      email: "casey@example.invalid",
      roles: ["admin"],
      entities: ["*"],
      active: true,
    },
  ];
  const metrics: Metric[] = [
    { id: "loans", label: "Loans", required: true },
    { id: "deposits", label: "Deposits", required: true },
    { id: "nii", label: "Net interest income", required: true },
    { id: "salary", label: "Salary expense", required: true },
    { id: "opex", label: "Other operating expense", required: true },
  ];
  const uploadedAt = "2026-09-03T14:00:00.000Z";
  state.packages = [
    {
      id: "blr-aug",
      title: "Business Line Review",
      period: "2026-08",
      entity: "BANK",
      dueAt: "2026-09-09T22:00:00.000Z",
      currentVersionId: "blr-v1",
      status: "IN_REVIEW",
      revision: 1,
    },
  ];
  state.evidence = [
    {
      id: "sample-blr",
      filename: "sample-blr-august-2026.pdf",
      sha256: "generated-at-seed",
      pageCount: 2,
      size: 0,
      contentType: "application/pdf",
      uploadedBy: "publisher",
      uploadedAt,
      scan: "LOCAL_ONLY",
      entity: "BANK",
    },
  ];
  state.versions = [
    {
      id: "blr-v1",
      packageId: "blr-aug",
      number: 1,
      fileId: "sample-blr",
      sha256: "generated-at-seed",
      filename: "sample-blr-august-2026.pdf",
      pageCount: 2,
      scan: "LOCAL_ONLY",
      status: "PUBLISHED",
      producedAt: uploadedAt,
      uploadedAt,
      publishedAt: uploadedAt,
      sections: [
        {
          id: "al",
          name: "Alabama",
          entity: "AL",
          pages: [1],
          metrics,
          reviewerIds: ["avery"],
        },
        {
          id: "tn",
          name: "Tennessee",
          entity: "TN",
          pages: [2],
          metrics: structuredClone(metrics),
          reviewerIds: ["jordan"],
        },
      ],
      revision: 1,
    },
  ];
  state.assignments = state.versions[0].sections.map((section) => ({
    id: `review-${section.id}`,
    versionId: "blr-v1",
    sectionId: section.id,
    reviewerId: section.reviewerIds[0],
    entity: section.entity,
    dueAt: state.packages[0].dueAt,
    responses: [],
    history: [],
    status: "NOT_STARTED",
    revision: 0,
  }));
  const base = {
    entity: "BANK",
    instructions:
      "Confirm the work is complete and attach supporting evidence where required.",
    dueOffset: 3,
    duration: 1,
    evidenceRequired: false,
    statement:
      "I confirm that the assigned work is complete and the supporting information reflects my review.",
  };
  const nodes: WorkflowNode[] = [
    {
      ...base,
      id: "entries",
      title: "Journal entries complete",
      type: "attestation",
      ownerId: "publisher",
      position: { x: 40, y: 60 },
    },
    {
      ...base,
      id: "ftp",
      title: "Profitability and FTP ready",
      type: "input",
      ownerId: "publisher",
      position: { x: 40, y: 240 },
      dueOffset: 5,
    },
    {
      ...base,
      id: "publish",
      title: "BLR published and validated",
      type: "task",
      ownerId: "publisher",
      position: { x: 370, y: 150 },
      dueOffset: 6,
    },
    {
      ...base,
      id: "review",
      title: "Financial reviews signed",
      type: "document_gate",
      ownerId: "publisher",
      position: { x: 700, y: 150 },
      dueOffset: 7,
      packageId: "blr-aug",
      documentVersionId: "blr-v1",
    },
    {
      ...base,
      id: "release",
      title: "Senior finance sign-off",
      type: "attestation",
      ownerId: "publisher",
      position: { x: 1030, y: 150 },
      dueOffset: 8,
    },
  ];
  state.templates = [
    {
      id: "close-template",
      name: "Month-end financial review",
      revision: 0,
      status: "DRAFT",
      nodes,
      edges: [
        { id: "e1", source: "entries", target: "publish", hard: true, lag: 0 },
        { id: "e2", source: "ftp", target: "publish", hard: true, lag: 0 },
        { id: "e3", source: "publish", target: "review", hard: true, lag: 0 },
        { id: "e4", source: "review", target: "release", hard: true, lag: 0 },
      ],
    },
  ];
  return state;
}
