import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import { expect, it, vi } from "vitest";
import check from "./check.js";
import { consumeCommandResult } from "../utils/commandResult.js";
import { checkExitCode, type CheckReport } from "../utils/checkPipeline.js";

it("persists real lint-blocked reports without overwriting earlier checks or inventing a revision", async () => {
  const project = mkdtempSync(join(tmpdir(), "hf-check-artifacts-"));
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  writeFileSync(
    join(project, "index.html"),
    "<html><body>Missing composition metadata</body></html>",
  );
  try {
    for (let i = 0; i < 2; i++) {
      await runCommand(check, { rawArgs: [project, "--json"] });
      consumeCommandResult();
    }
    const state = JSON.parse(readFileSync(join(project, ".hyperframes/video-state.json"), "utf8"));
    expect(state.checks.unversioned).toHaveLength(2);
    const [first, second] = state.checks.unversioned;
    expect(first.report).not.toBe(second.report);
    expect(first.report).toContain(".hyperframes/artifacts/checks/");
    expect(JSON.parse(readFileSync(first.report, "utf8")).browserSkipped).toBe(true);
    expect(state.checks.latest).toEqual({ revision: null, id: second.id });
    expect(state.checks.revisions).toEqual({});
    const output = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
    expect(output.saved).toEqual({
      id: second.id,
      revision: null,
      report: second.report,
      attribution: "unversioned",
    });
    expect(output.browserSkipped).toBe(true);
  } finally {
    log.mockRestore();
    consumeCommandResult();
    rmSync(project, { recursive: true, force: true });
  }
});

it("only warns when the report cannot be recorded; the exit status is the check's own", async () => {
  const project = mkdtempSync(join(tmpdir(), "hf-check-unrecorded-"));
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  writeFileSync(
    join(project, "index.html"),
    "<html><body>Missing composition metadata</body></html>",
  );
  mkdirSync(join(project, ".hyperframes", "artifacts"), { recursive: true });
  writeFileSync(join(project, ".hyperframes", "artifacts", "checks"), "not a directory");
  try {
    await runCommand(check, { rawArgs: [project, "--json"] });
    const output = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as CheckReport;
    expect(output).not.toHaveProperty("saved");
    expect(output.browserSkipped).toBe(true);
    expect(consumeCommandResult().exitCode).toBe(checkExitCode(output));
    expect(String(warn.mock.calls.at(-1)?.[0])).toContain("Check report was not recorded");
  } finally {
    log.mockRestore();
    warn.mockRestore();
    consumeCommandResult();
    rmSync(project, { recursive: true, force: true });
  }
});
