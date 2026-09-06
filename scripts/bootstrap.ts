import { transact } from "../src/server/store";
import type { Principal, Role } from "../src/lib/types";

const roles: Role[] = [
  "admin",
  "publisher",
  "reviewer",
  "designer",
  "manager",
  "reader",
];
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const entityPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function parsePrincipal(raw: string): Principal {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("WORKEVA_BOOTSTRAP_PRINCIPAL must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Bootstrap principal must be a JSON object.");
  const candidate = value as Partial<Principal>;
  if (typeof candidate.id !== "string" || !idPattern.test(candidate.id.trim()))
    throw new Error("Principal id is invalid.");
  if (
    typeof candidate.name !== "string" ||
    !candidate.name.trim() ||
    candidate.name.trim().length > 200
  )
    throw new Error("Principal name is invalid.");
  if (
    typeof candidate.email !== "string" ||
    candidate.email.trim().length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate.email.trim())
  )
    throw new Error("Principal email is invalid.");
  if (candidate.active !== true)
    throw new Error("Bootstrap principal must be explicitly active.");
  if (
    !Array.isArray(candidate.roles) ||
    candidate.roles.length === 0 ||
    new Set(candidate.roles).size !== candidate.roles.length ||
    candidate.roles.some((role) => !roles.includes(role as Role))
  )
    throw new Error("Principal roles are invalid.");
  if (
    !Array.isArray(candidate.entities) ||
    candidate.entities.length === 0 ||
    new Set(candidate.entities).size !== candidate.entities.length ||
    candidate.entities.some(
      (entity) =>
        typeof entity !== "string" ||
        (entity !== "*" && !entityPattern.test(entity)),
    )
  )
    throw new Error("Principal entities are invalid.");
  if (
    !candidate.roles.includes("admin") &&
    process.env.WORKEVA_BOOTSTRAP_ALLOW_NON_ADMIN !== "true"
  )
    throw new Error("The first bootstrap principal must have the admin role.");
  return {
    id: candidate.id.trim(),
    name: candidate.name.trim(),
    email: candidate.email.trim(),
    active: true,
    roles: [...candidate.roles] as Role[],
    entities: [...candidate.entities] as string[],
  };
}
async function main() {
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.WORKEVA_LOCAL_MODE === "true"
  )
    throw new Error("Bootstrap is a production-only operator action.");
  if (process.env.WORKEVA_BOOTSTRAP_CONFIRM !== "WORK EVA PROVISION")
    throw new Error(
      'Set WORKEVA_BOOTSTRAP_CONFIRM="WORK EVA PROVISION" for an explicit operator confirmation.',
    );
  const raw = process.env.WORKEVA_BOOTSTRAP_PRINCIPAL;
  if (!raw)
    throw new Error("Set WORKEVA_BOOTSTRAP_PRINCIPAL to a JSON Principal.");
  const principal = parsePrincipal(raw);
  await transact((state) => {
    if (
      state.users.length &&
      process.env.WORKEVA_BOOTSTRAP_ALLOW_UPDATE !== "true"
    )
      throw new Error(
        "Users already exist; set explicit update flag for a controlled change.",
      );
    const index = state.users.findIndex((user) => user.id === principal.id);
    if (index >= 0) state.users[index] = principal;
    else state.users.push(principal);
  });
  console.log(`Provisioned ${principal.id}.`);
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
