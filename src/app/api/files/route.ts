import { getPrincipal } from "@/server/auth";
import { saveFile } from "@/server/files";
import { transact } from "@/server/store";
import { DomainError, requireEntity, audit } from "@/server/domain";
import { errorResponse, sameOrigin } from "@/server/http";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const actor = await getPrincipal(request);
    if (
      !actor.roles.some((r) => ["publisher", "reviewer", "manager"].includes(r))
    )
      throw new DomainError(
        403,
        "File upload requires an assigned contributor role.",
      );
    if (Number(request.headers.get("content-length") || 0) > 51 * 1024 * 1024)
      throw new DomainError(413, "PDF must be under 50 MB.");
    const data = await request.formData();
    const file = data.get("file");
    const entity = String(data.get("entity") || "");
    requireEntity(actor, entity);
    if (!(file instanceof File))
      throw new DomainError(422, "Select a PDF file.");
    if (file.size > 50 * 1024 * 1024)
      throw new DomainError(413, "PDF must be under 50 MB.");
    const evidence = await saveFile(
      new Uint8Array(await file.arrayBuffer()),
      file.name,
      actor,
      entity,
    );
    await transact((state) => {
      state.evidence.push(evidence);
      audit(state, actor, "FILE_UPLOADED", evidence.id, evidence.filename);
    });
    return Response.json(evidence, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
