import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Principal } from "@/lib/types";
import { DomainError } from "./domain";
import { readState } from "./store";

export function isLocalMode(): boolean {
  return (
    process.env.WORKEVA_LOCAL_MODE === "true" &&
    process.env.NODE_ENV !== "production"
  );
}

function configuredUser(users: Principal[], id: string): Principal {
  const user = users.find(
    (candidate) => candidate.id === id && candidate.active,
  );
  if (!user)
    throw new DomainError(403, "Your account is not provisioned for WorkEva.");
  return user;
}

function localPrincipal(request: Request, users: Principal[]): Principal {
  const id =
    request.headers.get("x-workeva-user") ||
    request.headers
      .get("cookie")
      ?.match(/(?:^|;\s*)workeva-user=([^;]+)/)?.[1] ||
    "avery";
  try {
    return configuredUser(users, decodeURIComponent(id));
  } catch (error) {
    if (error instanceof URIError)
      throw new DomainError(401, "The local identity token is invalid.");
    throw error;
  }
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function principalFromEasyAuth(value: string, users: Principal[]): Principal {
  let parsed: {
    userId?: string;
    userDetails?: string;
    claims?: Array<{ typ?: string; val?: string }>;
  };
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new DomainError(401, "The identity boundary token is invalid.");
  }
  const claims = new Map(
    (parsed.claims || [])
      .filter((c) => c.typ && c.val)
      .map((c) => [c.typ!, c.val!]),
  );
  const id =
    parsed.userId ||
    claims.get(
      "http://schemas.microsoft.com/identity/claims/objectidentifier",
    ) ||
    claims.get("oid") ||
    claims.get("sub");
  if (!id)
    throw new DomainError(
      401,
      "The identity boundary did not provide a user id.",
    );
  return configuredUser(users, id);
}

function issuerAndAudience() {
  const tenant = process.env.ENTRA_TENANT_ID;
  const issuer =
    process.env.ENTRA_ISSUER ||
    (tenant ? `https://login.microsoftonline.com/${tenant}/v2.0` : undefined);
  const audience = process.env.ENTRA_AUDIENCE || process.env.AZURE_CLIENT_ID;
  if (!issuer || !audience)
    throw new DomainError(503, "Entra ID is not configured.");
  try {
    const parsed = new URL(issuer);
    if (parsed.protocol !== "https:") throw new Error("issuer must use HTTPS");
  } catch {
    throw new DomainError(503, "Entra issuer must be a valid HTTPS URL.");
  }
  return { issuer, audience };
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let jwksUrl: string | undefined;
async function verifyBearer(token: string): Promise<JWTPayload> {
  const { issuer, audience } = issuerAndAudience();
  let url = process.env.ENTRA_JWKS_URL?.trim();
  if (!url) {
    // Microsoft Entra's v2 issuer ends in /v2.0, while its tenant JWKS
    // endpoint is /{tenant}/discovery/v2.0/keys. Appending discovery after
    // /v2.0 produces a non-existent /v2.0/discovery path.
    const parsed = new URL(issuer);
    const tenantPath = parsed.pathname
      .replace(/\/v2\.0\/?$/, "")
      .replace(/\/$/, "");
    url = new URL(
      `${tenantPath}/discovery/v2.0/keys`,
      parsed.origin,
    ).toString();
  }
  try {
    if (new URL(url).protocol !== "https:")
      throw new Error("JWKS must use HTTPS");
  } catch {
    throw new DomainError(503, "Entra JWKS URL must be a valid HTTPS URL.");
  }
  if (!jwks || jwksUrl !== url) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksUrl = url;
  }
  try {
    return (
      await jwtVerify(token, jwks, { issuer, audience, algorithms: ["RS256"] })
    ).payload;
  } catch {
    throw new DomainError(401, "The Entra access token is invalid or expired.");
  }
}

export async function getPrincipal(request: Request): Promise<Principal> {
  const state = await readState();
  if (isLocalMode()) return localPrincipal(request, state.users);

  // EasyAuth is accepted only when the deployment explicitly establishes it as a trusted boundary.
  // Raw x-ms-client-principal headers are ignored by default because a direct caller can spoof them.
  const easyAuth = request.headers.get("x-ms-client-principal");
  if (
    easyAuth &&
    process.env.WORKEVA_TRUST_EASYAUTH === "true" &&
    process.env.WEBSITE_AUTH_ENABLED === "true"
  ) {
    return principalFromEasyAuth(easyAuth, state.users);
  }
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer "))
    throw new DomainError(401, "Sign in with Microsoft Entra ID to continue.");
  const payload = await verifyBearer(authorization.slice(7).trim());
  const id = stringClaim(payload.oid) || stringClaim(payload.sub);
  if (!id) throw new DomainError(401, "The Entra token has no stable user id.");
  return configuredUser(state.users, id);
}
