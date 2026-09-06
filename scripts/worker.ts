import { processOutboxOnce } from "../src/server/notifications";

async function main() {
  if (process.env.WORKEVA_WORKER_ONCE === "true") {
    await processOutboxOnce();
    return;
  }
  const interval = Math.max(
    1_000,
    Number(process.env.WORKEVA_WORKER_INTERVAL_MS || 5_000),
  );
  while (true) {
    try {
      await processOutboxOnce();
    } catch (error) {
      console.error("[workeva-worker]", error);
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
void main().catch((error) => {
  console.error("[workeva-worker]", error);
  process.exitCode = 1;
});
