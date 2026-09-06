import { readState } from "../src/server/store";
if (
  process.env.WORKEVA_LOCAL_MODE !== "true" ||
  process.env.NODE_ENV === "production"
)
  throw new Error("Seed only runs with explicit local development mode.");
async function main() {
  const state = await readState();
  console.log(
    `Local workspace ready: ${state.packages.length} package(s), ${state.users.length} synthetic users. Existing data retained.`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
