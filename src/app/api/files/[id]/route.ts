import { getPrincipal } from "@/server/auth";
import { readFile } from "@/server/files";
import { readState, transact } from "@/server/store";
import { canReadEvidence } from "@/server/access";
import { DomainError, audit } from "@/server/domain";
import { errorResponse } from "@/server/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await getPrincipal(request);
    const state = await readState();
    const { id } = await params;
    const evidence = state.evidence.find((e) => e.id === id);
    if (!evidence || !canReadEvidence(state, actor, evidence))
      throw new DomainError(404, "Document not found.");
    if (evidence.scan === "PENDING" || evidence.scan === "REJECTED")
      throw new DomainError(422, "Document has not passed file validation.");
    const bytes = await readFile(evidence);
    await transact((s) => audit(s, actor, "FILE_VIEWED", id));
    return new Response(bytes as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${evidence.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
