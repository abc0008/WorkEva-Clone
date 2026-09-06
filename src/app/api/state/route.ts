import { getPrincipal, isLocalMode } from "@/server/auth";
import { readState } from "@/server/store";
import { scopedSnapshot } from "@/server/access";
import { errorResponse } from "@/server/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    return Response.json(
      scopedSnapshot(
        await readState(),
        await getPrincipal(request),
        isLocalMode(),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
