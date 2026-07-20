import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { MicroPcError } from "@micropc/core/errors.js";

const LOCK_RETRIES = 100;
const LOCK_RETRY_MS = 20;
const STALE_LOCK_MS = 30_000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface JsonStoreOptions<T> {
  initial(): T;
  parse(value: unknown): T;
}

export class JsonStore<T> {
  private readonly path: string;
  private readonly options: JsonStoreOptions<T>;

  constructor(path: string, options: JsonStoreOptions<T>) {
    this.path = path;
    this.options = options;
  }

  async read(): Promise<T> {
    try {
      return this.options.parse(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return this.options.initial();
      if (error instanceof MicroPcError) throw error;
      throw new MicroPcError("STATE_READ_FAILED", `Cannot read state at ${this.path}: ${(error as Error).message}`);
    }
  }

  async write(value: T): Promise<void> {
    const directory = dirname(this.path);
    const temp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      const handle = await open(temp, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, this.path);
      await syncDirectory(directory);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  async update<R>(mutate: (value: T) => R | Promise<R>): Promise<R> {
    const lockPath = `${this.path}.lock`;
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const lock = await acquireLock(lockPath);
    try {
      const value = await this.read();
      const result = await mutate(value);
      await this.write(value);
      return result;
    } finally {
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }
}

async function acquireLock(lockPath: string): Promise<Awaited<ReturnType<typeof open>>> {
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
    try {
      return await open(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await isStaleLock(lockPath)) {
        await rm(lockPath, { force: true });
        continue;
      }
      await wait(LOCK_RETRY_MS);
    }
  }
  throw new MicroPcError("STATE_LOCK_TIMEOUT", `Timed out waiting for state lock ${lockPath}`);
}

async function isStaleLock(lockPath: string): Promise<boolean> {
  try {
    return Date.now() - (await stat(lockPath)).mtimeMs > STALE_LOCK_MS;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EISDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
  }
}
