import { DefaultAzureCredential } from "@azure/identity";
import type { Principal } from "@/lib/types";
import { DomainError, requireEntity } from "./domain";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_POLLS = 30;
const ENTITY_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

function settings() {
  const host = process.env.DATABRICKS_HOST?.replace(/\/$/, "");
  const warehouse = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!host || !warehouse)
    throw new DomainError(503, "Databricks reference data is not configured.");
  if (!/^https:\/\//i.test(host))
    throw new DomainError(503, "Databricks host must use HTTPS.");
  const table =
    process.env.DATABRICKS_REFERENCE_TABLE || "main.workeva.reporting_entities";
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,2}$/.test(table))
    throw new DomainError(503, "Databricks reference table is invalid.");
  return { host, warehouse, table };
}

let credential: DefaultAzureCredential | undefined;
let cachedToken:
  | { scope: string; value: string; expiresAt: number }
  | undefined;
let tokenRequest: Promise<string> | undefined;
async function token() {
  const configured = process.env.DATABRICKS_TOKEN?.trim();
  if (configured) return configured;
  const scope =
    process.env.DATABRICKS_SCOPE ||
    "2ff814a6-3304-4ab8-85cb-cd0e6f879c1d/.default";
  // Reuse the credential and refresh before expiry. This avoids creating a
  // credential per request and prevents a long-lived worker from sending an
  // expired managed-identity token.
  if (
    cachedToken &&
    cachedToken.scope === scope &&
    cachedToken.expiresAt > Date.now() + 60_000
  )
    return cachedToken.value;
  if (tokenRequest) return tokenRequest;
  credential ??= new DefaultAzureCredential();
  tokenRequest = (async () => {
    try {
      const result = await credential!.getToken(scope);
      if (!result?.token)
        throw new DomainError(
          503,
          "Databricks workload identity is unavailable.",
        );
      cachedToken = {
        scope,
        value: result.token,
        expiresAt: Number(result.expiresOnTimestamp) || Date.now() + 5 * 60_000,
      };
      return result.token;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        503,
        "Databricks workload identity is unavailable.",
      );
    }
  })();
  try {
    return await tokenRequest;
  } finally {
    tokenRequest = undefined;
  }
}

function abortAfter(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, timer };
}

/** Fetches the approved, entity-scoped reference query. Arbitrary browser SQL is never accepted. */
export async function fetchDatabricksData(
  actor: Principal,
  entity: string,
): Promise<unknown> {
  if (!ENTITY_RE.test(entity))
    throw new DomainError(422, "Entity code is invalid.");
  requireEntity(actor, entity);
  const config = settings();
  const accessToken = await token();
  const timeoutCandidate = Number(
    process.env.DATABRICKS_TIMEOUT_MS || DEFAULT_TIMEOUT_MS,
  );
  const timeout =
    Number.isFinite(timeoutCandidate) && timeoutCandidate > 0
      ? timeoutCandidate
      : DEFAULT_TIMEOUT_MS;
  const maxPolls = Math.min(
    60,
    Math.max(1, Number(process.env.DATABRICKS_MAX_POLLS || DEFAULT_MAX_POLLS)),
  );
  const query = `SELECT entity_id, entity_name, effective_from, effective_to FROM ${config.table} WHERE entity_id = :entity ORDER BY effective_from DESC LIMIT 100`;
  const headers = {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  };
  const deadline = Date.now() + timeout;
  const initial = abortAfter(timeout);
  try {
    const response = await fetch(`${config.host}/api/2.0/sql/statements`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        statement: query,
        warehouse_id: config.warehouse,
        wait_timeout: "0s",
        disposition: "INLINE",
        parameters: [{ name: "entity", type: "STRING", value: entity }],
      }),
      signal: initial.controller.signal,
    });
    if (!response.ok)
      throw new DomainError(
        502,
        `Databricks rejected the reference query (${response.status}).`,
      );
    let statement = (await response.json()) as Record<string, unknown>;
    let polls = 0;
    while (
      statement.status &&
      typeof statement.status === "object" &&
      ["PENDING", "RUNNING"].includes(
        String((statement.status as Record<string, unknown>).state),
      ) &&
      polls++ < maxPolls &&
      Date.now() < deadline
    ) {
      if (typeof statement.statement_id !== "string" || !statement.statement_id)
        throw new DomainError(
          502,
          "Databricks returned an invalid statement reference.",
        );
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new DomainError(504, "Databricks reference query timed out.");
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(500, remaining)),
      );
      const poll = await fetch(
        `${config.host}/api/2.0/sql/statements/${encodeURIComponent(String(statement.statement_id))}`,
        { headers, signal: initial.controller.signal },
      );
      if (!poll.ok)
        throw new DomainError(
          502,
          `Databricks polling failed (${poll.status}).`,
        );
      statement = (await poll.json()) as Record<string, unknown>;
    }
    const state = (statement.status as Record<string, unknown> | undefined)
      ?.state;
    if (state === "PENDING" || state === "RUNNING")
      throw new DomainError(504, "Databricks reference query timed out.");
    if (state === "FAILED" || state === "CANCELED" || state === "CLOSED")
      throw new DomainError(
        502,
        "Databricks reference query did not complete.",
      );
    if (state !== "SUCCEEDED")
      throw new DomainError(
        502,
        "Databricks returned an unexpected statement status.",
      );
    const result = statement.result as Record<string, unknown> | undefined;
    return {
      entity,
      fetchedAt: new Date().toISOString(),
      statementId: statement.statement_id,
      schema: (statement.manifest as Record<string, unknown> | undefined)
        ?.schema,
      data: result?.data_array ?? [],
    };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if ((error as Error).name === "AbortError")
      throw new DomainError(504, "Databricks reference query timed out.");
    throw new DomainError(502, "Databricks reference data is unavailable.");
  } finally {
    clearTimeout(initial.timer);
  }
}
