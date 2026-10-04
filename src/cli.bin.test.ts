/**
 * cli.ts bin-entry detection: the module must run main() when invoked as the
 * installed bin — including the symlink case npm uses for `bin` entries
 * (.bin/probe -> dist/cli.js), where argv[1] does NOT end in "cli.js".
 */
import { mkdtempSync, symlinkSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, test, afterAll } from "vitest";
import { isDirectInvocation } from "./cli.js";

describe("isDirectInvocation (bin entry detection)", () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-bin-"));
  const realFile = join(dir, "cli.js");
  const binLink = join(dir, "probe");
  writeFileSync(realFile, "");
  symlinkSync(realFile, binLink);

  // The module URL is what the runtime resolves to a realpath, so the
  // fixture URL is built from the realpath'd dir (tmp parents can symlink).
  const dirReal = realpathSync(dir);
  const moduleUrlFor = (file: string) => pathToFileURL(join(dirReal, file.split("/").pop()!)).href;
  const realFileUrl = moduleUrlFor(realFile);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("symlinked bin name resolves to the module file (the npm .bin case)", ({
    expect,
  }) => {
    expect(isDirectInvocation(binLink, realFileUrl)).toBe(true);
  });

  test("the module file's own path invokes directly", ({ expect }) => {
    expect(isDirectInvocation(realFile, realFileUrl)).toBe(true);
  });

  test("a different argv[1] (test harness, REPL) does not", ({ expect }) => {
    expect(isDirectInvocation(join(dir, "vitest"), realFileUrl)).toBe(false);
  });

  test("undefined argv[1] never invokes", ({ expect }) => {
    expect(isDirectInvocation(undefined, pathToFileURL(realFile).href)).toBe(
      false,
    );
  });
});
