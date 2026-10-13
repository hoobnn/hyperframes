import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectLockTimeout, projectLockPath, withProjectLock } from "./projectLock.js";

const directories: string[] = [];
const project = () => {
  const directory = mkdtempSync(join(tmpdir(), "hf-project-lock-"));
  directories.push(directory);
  return directory;
};
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const locked = (waitMs: number) => ({ projectLock: { waitMs } });
const hold = (dir: string, pid: number) => {
  mkdirSync(dirname(projectLockPath(dir)), { recursive: true });
  writeFileSync(projectLockPath(dir), JSON.stringify({ pid, command: "check", startedAt: 1 }));
};

describe("withProjectLock", () => {
  it("runs without a lock file when the capability is absent", async () => {
    const dir = project();
    expect(
      await withProjectLock(dir, "check", async () => existsSync(projectLockPath(dir)), {}),
    ).toBe(false);
  });

  it("holds the lock while running and releases it afterwards, even on failure", async () => {
    const dir = project();
    const seen = await withProjectLock(
      dir,
      "snapshot",
      async () => JSON.parse(readFileSync(projectLockPath(dir), "utf8")),
      locked(0),
    );
    expect(seen).toMatchObject({ pid: process.pid, command: "snapshot" });
    expect(existsSync(projectLockPath(dir))).toBe(false);
    await expect(
      withProjectLock(dir, "check", async () => Promise.reject(new Error("boom")), locked(0)),
    ).rejects.toThrow("boom");
    expect(existsSync(projectLockPath(dir))).toBe(false);
  });

  it("serializes concurrent holders in one project", async () => {
    const dir = project();
    const order: string[] = [];
    const task = (name: string) =>
      withProjectLock(
        dir,
        name,
        async () => {
          order.push(`${name}:start`);
          await new Promise((done) => setTimeout(done, 50));
          order.push(`${name}:end`);
        },
        locked(5000),
      );
    await Promise.all([task("check"), task("snapshot")]);
    expect(order).toEqual(["check:start", "check:end", "snapshot:start", "snapshot:end"]);
  });

  it("waits up to waitMs for a live holder, then refuses with who holds it", async () => {
    const dir = project();
    hold(dir, process.pid);
    const started = Date.now();
    await expect(withProjectLock(dir, "snapshot", async () => "ran", locked(300))).rejects.toThrow(
      ProjectLockTimeout,
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    await expect(withProjectLock(dir, "snapshot", async () => "ran", locked(0))).rejects.toThrow(
      `hyperframes check (pid ${process.pid}) is still using this project`,
    );
  });

  it("takes over a lock whose process has exited", async () => {
    const dir = project();
    hold(dir, 2 ** 22 + 12345);
    expect(await withProjectLock(dir, "check", async () => "ran", locked(0))).toBe("ran");
  });
});
