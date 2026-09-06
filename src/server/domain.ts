import { createHash, randomUUID } from "node:crypto";
import type { AppState, Principal, Signature, Role } from "@/lib/types";
export class DomainError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function requireRole(actor: Principal, ...roles: Role[]) {
  if (!actor.active || !roles.some((role) => actor.roles.includes(role)))
    throw new DomainError(403, "You do not have permission for this action.");
}
export function requireEntity(actor: Principal, entity: string) {
  if (
    !actor.active ||
    !(actor.entities.includes("*") || actor.entities.includes(entity))
  )
    throw new DomainError(403, "This reporting unit is outside your access.");
}
export function revision(actual: number, expected: unknown) {
  if (actual !== expected)
    throw new DomainError(
      409,
      "This item changed. Refresh and review the latest version.",
    );
}
export function audit(
  state: AppState,
  actor: Principal,
  action: string,
  subjectId: string,
  detail = "",
) {
  state.audit.push({
    id: id(),
    action,
    subjectId,
    by: actor.id,
    at: now(),
    detail,
  });
}
export function notify(
  state: AppState,
  type: string,
  subjectId: string,
  recipientId: string,
  message: string,
) {
  state.outbox.push({
    id: id(),
    type,
    subjectId,
    recipientId,
    message,
    status: "PENDING",
    attempts: 0,
    createdAt: now(),
  });
}
export function isValidSignature(
  state: AppState,
  signatureId?: string,
): boolean {
  return (
    !!signatureId &&
    state.signatures.some((s) => s.id === signatureId) &&
    !state.signatureEvents.some((e) => e.signatureId === signatureId)
  );
}
export function invalidateSignature(
  state: AppState,
  signatureId: string | undefined,
  actor: Principal,
  reason: string,
) {
  if (signatureId && isValidSignature(state, signatureId))
    state.signatureEvents.push({
      id: id(),
      signatureId,
      action: "INVALIDATED",
      reason,
      by: actor.id,
      at: now(),
    });
}
export function addSignature(
  state: AppState,
  signature: Omit<Signature, "id" | "at">,
) {
  const record = { ...signature, id: id(), at: now() };
  state.signatures.push(record);
  return record;
}
export function requireText(value: unknown, label: string, max = 5000) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new DomainError(
      422,
      `${label} is required and must be under ${max} characters.`,
    );
  return value.trim();
}
