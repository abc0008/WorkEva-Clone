import {
  mkdir,
  readFile as fsReadFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AppState } from "@/lib/types";
import { DomainError } from "./domain";
import { emptyState, seedState } from "@/lib/seed";
import { ensureSeedPdf } from "./files";

const LOCK_TIMEOUT_MS = 30_000;
const LOCK_STALE_MS = 120_000;
const LOCK_RETRY_MS = 50;
let localQueue: Promise<unknown> = Promise.resolve();
let sqlPoolPromise: Promise<import("mssql").ConnectionPool> | undefined;

export function isLocalStore(): boolean {
  return (
    process.env.WORKEVA_LOCAL_MODE === "true" &&
    process.env.NODE_ENV !== "production"
  );
}

function statePath() {
  return (
    process.env.WORKEVA_STATE_FILE || join(process.cwd(), ".data", "state.json")
  );
}

async function acquireFileLock(path: string): Promise<() => Promise<void>> {
  const lockPath = `${path}.lock`;
  const started = Date.now();
  await mkdir(dirname(path), { recursive: true });
  while (Date.now() - started < LOCK_TIMEOUT_MS) {
    try {
      await mkdir(lockPath);
      const token = randomUUID();
      await writeFile(
        join(lockPath, "owner"),
        `${token}\n${Date.now()}`,
        "utf8",
      );
      return async () => {
        // A stale lock may have been removed and replaced while this process was
        // working. Never remove a lock that belongs to the replacement owner.
        const owner = await fsReadFile(join(lockPath, "owner"), "utf8").catch(
          () => "",
        );
        if (owner.split("\n", 1)[0] === token)
          await rm(lockPath, { recursive: true, force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const info = await stat(join(lockPath, "owner")).catch(() =>
          stat(lockPath),
        );
        if (Date.now() - info.mtimeMs > LOCK_STALE_MS)
          await rm(lockPath, { recursive: true, force: true });
      } catch {
        /* another process is creating/removing the lock */
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
  throw new DomainError(
    503,
    "The local state store is busy; retry the request.",
  );
}

async function localReadAndMaybeSeed(): Promise<AppState> {
  const path = statePath();
  try {
    const text = await fsReadFile(/* turbopackIgnore: true */ path, "utf8");
    const existing = JSON.parse(text) as AppState;
    const sample = existing.evidence.find((item) => item.id === "sample-blr");
    if (
      sample &&
      (sample.sha256 === "generated-at-seed" || sample.size === 0)
    ) {
      const hydrated = await ensureSeedPdf(sample);
      Object.assign(sample, hydrated);
      for (const version of existing.versions)
        if (version.fileId === sample.id) {
          version.sha256 = hydrated.sha256;
          version.pageCount = hydrated.pageCount;
          version.scan = hydrated.scan;
        }
      await atomicWrite(path, existing);
    }
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new DomainError(500, "The local state store is unreadable.");
    const initial = seedState();
    const sample = initial.evidence.find((item) => item.id === "sample-blr");
    if (sample) {
      const hydrated = await ensureSeedPdf(sample);
      Object.assign(sample, hydrated);
      for (const version of initial.versions)
        if (version.fileId === sample.id) {
          version.sha256 = hydrated.sha256;
          version.pageCount = hydrated.pageCount;
          version.scan = hydrated.scan;
        }
    }
    await atomicWrite(path, initial);
    return initial;
  }
}

async function atomicWrite(path: string, state: AppState) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);
}

async function localTransact<T>(
  fn: (state: AppState) => T | Promise<T>,
): Promise<T> {
  let resolveQueued!: (value: T | PromiseLike<T>) => void;
  let rejectQueued!: (reason?: unknown) => void;
  const result = new Promise<T>((resolve, reject) => {
    resolveQueued = resolve;
    rejectQueued = reject;
  });
  const previous = localQueue;
  const run = async () => {
    const path = statePath();
    let release: (() => Promise<void>) | undefined;
    try {
      release = await acquireFileLock(path);
      const state = await localReadAndMaybeSeed();
      const output = await fn(state);
      state.revision =
        (Number.isFinite(state.revision) ? state.revision : 0) + 1;
      await atomicWrite(path, state);
      // Resolve only after releasing the lock. This keeps callers from starting
      // dependent work while the durable write is still locked.
      await release();
      release = undefined;
      resolveQueued(output);
    } catch (error) {
      try {
        if (release) await release();
      } catch {
        /* preserve the operation error */
      }
      rejectQueued(error);
    }
  };
  // Keep the queue usable after a failed lock acquisition or callback. A failed
  // operation rejects its own result while the next operation still runs.
  localQueue = previous.then(run, run).catch(() => undefined);
  return result;
}

function sqlSettings() {
  const server = process.env.AZURE_SQL_SERVER;
  const database = process.env.AZURE_SQL_DATABASE;
  if (!server || !database)
    throw new DomainError(503, "Azure SQL is not configured.");
  return { server, database };
}

async function sqlPool() {
  const settings = sqlSettings();
  if (!sqlPoolPromise) {
    sqlPoolPromise = (async () => {
      const sql = await import("mssql");
      const config: import("mssql").config = {
        server: settings.server,
        database: settings.database,
        options: { encrypt: true, trustServerCertificate: false },
        pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 },
      };
      if (process.env.AZURE_SQL_USER && process.env.AZURE_SQL_PASSWORD) {
        config.user = process.env.AZURE_SQL_USER;
        config.password = process.env.AZURE_SQL_PASSWORD;
      } else {
        // Tedious obtains and refreshes managed-identity tokens for each connection.
        config.authentication = {
          type: "azure-active-directory-default",
          options: { clientId: process.env.AZURE_CLIENT_ID },
        };
      }
      return new sql.ConnectionPool(config).connect();
    })().catch((error) => {
      sqlPoolPromise = undefined;
      throw error;
    });
  }
  return sqlPoolPromise;
}

async function ensureSqlTable(tx: import("mssql").Transaction) {
  await tx.request().query(`
    IF OBJECT_ID(N'dbo.workeva_state', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.workeva_state (
        id tinyint NOT NULL CONSTRAINT PK_workeva_state PRIMARY KEY,
        revision bigint NOT NULL,
        payload nvarchar(max) NOT NULL,
        updated_at datetime2(7) NOT NULL CONSTRAINT DF_workeva_state_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_workeva_state_json CHECK (ISJSON(payload)=1)
      );
    END
  `);
}

async function sqlTransact<T>(
  fn: (state: AppState) => T | Promise<T>,
): Promise<T> {
  const sql = await import("mssql");
  const pool = await sqlPool();
  const tx = pool.transaction();
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const lock = await tx
      .request()
      .query<{
        result: number;
      }>(`DECLARE @result int; EXEC @result = sp_getapplock @Resource = N'workeva_state', @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 30000; SELECT @result AS result;`);
    const lockResult = Number(lock.recordset[0]?.result);
    if (!Number.isInteger(lockResult) || lockResult < 0)
      throw new DomainError(
        503,
        "Azure SQL aggregate lock could not be acquired.",
      );
    await ensureSqlTable(tx);
    const row = (
      await tx
        .request()
        .query<{
          revision: number;
          payload: string;
        }>(`SELECT revision, payload FROM dbo.workeva_state WITH (UPDLOCK, HOLDLOCK) WHERE id = 1`)
    ).recordset[0];
    const state = row ? (JSON.parse(row.payload) as AppState) : emptyState();
    const output = await fn(state);
    state.revision =
      (Number.isFinite(state.revision)
        ? state.revision
        : Number(row?.revision ?? 0)) + 1;
    await tx
      .request()
      .input("revision", state.revision)
      .input("payload", JSON.stringify(state)).query(`
      MERGE dbo.workeva_state WITH (HOLDLOCK) AS target
      USING (SELECT CAST(1 AS tinyint) AS id) AS source ON target.id = source.id
      WHEN MATCHED THEN UPDATE SET revision=@revision, payload=@payload, updated_at=SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (id, revision, payload) VALUES (1, @revision, @payload);
    `);
    await tx.commit();
    return output;
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      /* preserve original failure */
    }
    throw error;
  }
}

export async function readState(): Promise<AppState> {
  if (isLocalStore()) {
    const path = statePath();
    const release = await acquireFileLock(path);
    try {
      return await localReadAndMaybeSeed();
    } finally {
      await release();
    }
  }
  const sql = await import("mssql");
  const pool = await sqlPool();
  const tx = pool.transaction();
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    // Reads can initialize the singleton row. Use the same exclusive app lock
    // as writers so two first readers cannot both observe an absent row.
    const lock = await tx
      .request()
      .query<{
        result: number;
      }>(`DECLARE @result int; EXEC @result = sp_getapplock @Resource = N'workeva_state', @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 30000; SELECT @result AS result;`);
    const lockResult = Number(lock.recordset[0]?.result);
    if (!Number.isInteger(lockResult) || lockResult < 0)
      throw new DomainError(
        503,
        "Azure SQL aggregate lock could not be acquired.",
      );
    await ensureSqlTable(tx);
    const row = (
      await tx
        .request()
        .query<{
          payload: string;
        }>("SELECT payload FROM dbo.workeva_state WITH (UPDLOCK, HOLDLOCK) WHERE id = 1")
    ).recordset[0];
    const state = row ? (JSON.parse(row.payload) as AppState) : emptyState();
    if (!row)
      await tx
        .request()
        .input("payload", JSON.stringify(state))
        .query(
          `INSERT dbo.workeva_state (id, revision, payload) VALUES (1, 0, @payload)`,
        );
    await tx.commit();
    return state;
  } catch (error) {
    try {
      await tx.rollback();
    } catch {}
    throw error;
  }
}

export async function transact<T>(
  fn: (state: AppState) => T | Promise<T>,
): Promise<T> {
  if (isLocalStore()) return localTransact(fn);
  return sqlTransact(fn);
}
