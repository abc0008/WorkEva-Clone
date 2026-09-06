import { DomainError } from "./domain";
export function errorResponse(error: unknown) {
  if (error instanceof DomainError)
    return Response.json({ error: error.message }, { status: error.status });
  console.error(
    "WorkEva request failed",
    error instanceof Error ? error.name : "Unknown error",
  );
  return Response.json(
    {
      error:
        "The operation could not be completed. Please retry or contact your administrator.",
    },
    { status: 500 },
  );
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new DomainError(403, "Cross-origin writes are not allowed.");
  if (origin) {
    // Next's internal request URL can normalize 127.0.0.1 to localhost. The
    // browser-controlled Host header reflects the externally requested host.
    let supplied: URL;
    try {
      supplied = new URL(origin);
    } catch {
      throw new DomainError(403, "Invalid request origin.");
    }
    const configured =
      process.env.WORKEVA_APP_URL || process.env.WORKEVA_BASE_URL;
    const expectedHost = configured
      ? new URL(configured).host
      : request.headers.get("host") || new URL(request.url).host;
    if (
      supplied.host !== expectedHost ||
      !["http:", "https:"].includes(supplied.protocol) ||
      (configured && supplied.protocol !== new URL(configured).protocol)
    )
      throw new DomainError(403, "Cross-origin writes are not allowed.");
  }
}
