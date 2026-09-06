import { getPrincipal } from "@/server/auth";
import { readState } from "@/server/store";
import { scopedSnapshot } from "@/server/access";
import { getTaskImpact } from "@/server/workflow";
import { DomainError } from "@/server/domain";
import { errorResponse } from "@/server/http";
export async function GET(request: Request) {
  try {
    const actor = await getPrincipal(request);
    const state = await readState();
    const p = new URL(request.url).searchParams;
    const runId = p.get("runId") || "";
    if (!scopedSnapshot(state, actor, false).runs.some((r) => r.id === runId))
      throw new DomainError(404, "Workflow not found");
    return Response.json(getTaskImpact(state, runId, p.get("taskId") || ""));
  } catch (e) {
    return errorResponse(e);
  }
}
