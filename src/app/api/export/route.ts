import { getPrincipal } from "@/server/auth";
import { transact } from "@/server/store";
import { exportPackage } from "@/server/access";
import { audit } from "@/server/domain";
import { errorResponse } from "@/server/http";
export async function GET(request: Request) {
  try {
    const actor = await getPrincipal(request);
    const manifest = await transact((state) => {
      const result = exportPackage(
        state,
        actor,
        new URL(request.url).searchParams.get("packageId") || "",
      );
      audit(
        state,
        actor,
        "PACKAGE_EXPORTED",
        result.package.id,
        `version=${result.document.id}`,
      );
      return result;
    });
    return Response.json(manifest, {
      headers: {
        "Content-Disposition":
          'attachment; filename="workeva-review-manifest.json"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
