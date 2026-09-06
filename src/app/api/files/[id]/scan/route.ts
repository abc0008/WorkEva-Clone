import { getPrincipal } from "@/server/auth";
import { verifyBlobScan } from "@/server/files";
import { readState, transact } from "@/server/store";
import {
  DomainError,
  audit,
  requireEntity,
  requireRole,
} from "@/server/domain";
import { errorResponse, sameOrigin } from "@/server/http";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const actor = await getPrincipal(request);
    requireRole(actor, "publisher", "manager", "admin");
    const { id } = await params;
    const evidence = (await readState()).evidence.find((e) => e.id === id);
    if (!evidence) throw new DomainError(404, "File not found.");
    requireEntity(actor, evidence.entity);
    const checked = await verifyBlobScan(evidence);
    await transact((state) => {
      const current = state.evidence.find((e) => e.id === id);
      if (!current || current.sha256 !== evidence.sha256)
        throw new DomainError(409, "File changed during verification.");
      current.scan = checked.scan;
      for (const version of state.versions.filter(
        (v) => v.fileId === id && v.status === "DRAFT",
      ))
        version.scan = checked.scan;
      audit(state, actor, "FILE_SCAN_VERIFIED", id, checked.scan);
    });
    return Response.json(checked);
  } catch (error) {
    return errorResponse(error);
  }
}
