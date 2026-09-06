import { getPrincipal } from "@/server/auth";
import { fetchDatabricksData } from "@/server/databricks";
import { errorResponse } from "@/server/http";
export async function GET(request: Request) {
  try {
    return Response.json(
      await fetchDatabricksData(
        await getPrincipal(request),
        new URL(request.url).searchParams.get("entity") || "",
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
