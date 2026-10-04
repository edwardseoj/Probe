/**
 * cli.ts — one verb, no subcommands: probe <target> [flags].
 * Usage errors (exit 3, ADR-0002) are decided here, in the input-validation
 * path, BEFORE any network I/O — never through the verdict path.
 */

import { Command, CommanderError } from "commander";
import chalk from "chalk";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { run } from "./run.js";
import { exitCodeFor } from "./verdict.js";
import type { RunOptions } from "./run.js";
import { renderRun } from "./output.js";
import type { OutputMode } from "./output.js";
import { runResultJson } from "./json.js";

export const USAGE_EXIT_CODE = 3;

/**
 * The CLI's own network boundaries (undici global dispatcher, node:tls)
 * are the defaults; runOptions overrides exist for the test seam the same
 * way run() takes fetchImpl/tlsProbe. The --timeout flag always wins.
 */
export async function main(
  argv: string[],
  runOptions?: Partial<RunOptions>,
): Promise<number> {
  const program = new Command();
  program
    .name("probe")
    .description("Post-deployment sanity check. Deploy, run Probe, know.")
    .argument("<target>", "HTTP(S) target to check")
    .option("--timeout <seconds>", "Run budget in seconds (default 10)", "10")
    .option("--path <p>", "Health path to point check (repeatable)", collectRepeating, [] as string[])
    .option("--verbose", "Add Facts and passing-check detail to the default output")
    .option("--quiet", "Print only the Verdict line")
    .option("--json", "Full machine-readable output (stable shape)")
    .exitOverride();

  let target: string;
  let timeoutRaw: string;
  let paths: string[];
  let mode: OutputMode;
  let json: boolean;
  try {
    program.parse(argv, { from: "user" });
    const flags = program.opts<{
      timeout?: string;
      verbose?: boolean;
      quiet?: boolean;
      path?: string[];
      json?: boolean;
    }>();
    target = program.args[0];
    timeoutRaw = flags.timeout ?? "10";
    paths = flags.path ?? [];
    mode = flags.quiet ? "quiet" : flags.verbose ? "verbose" : "default";
    json = flags.json === true;
  } catch (error) {
    if (
      error instanceof CommanderError &&
      (error.code === "commander.helpDisplayed" || error.code === "commander.version")
    ) {
      return 0;
    }
    usageError(error instanceof Error ? error.message.split("\n")[0] : "Invalid input");
    return USAGE_EXIT_CODE;
  }

  const timeoutSeconds = Number(timeoutRaw);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0) {
    usageError(`Invalid --timeout value: ${timeoutRaw}`);
    return USAGE_EXIT_CODE;
  }

  const validated = validateTarget(target);
  if (validated === null) {
    return USAGE_EXIT_CODE;
  }

  const validatedPaths = validatePaths(paths);
  if (validatedPaths === null) {
    return USAGE_EXIT_CODE;
  }

  const options: RunOptions = {
    ...runOptions,
    timeoutSeconds: timeoutSeconds,
    paths: validatedPaths,
  };
  const runResult = await run(validated, options);
  /**
   * --json is its own output mode that supersedes the text tiers (ticket
   * #9, SPEC "Output"): JSON always carries the full shape, so --verbose/
   * --quiet have no additional effect. The shape is JSON.stringify'd here
   * and written with a trailing newline; json.ts builds the shape purely.
   * Never colored — structurally, not by TTY accident: the JSON path never
   * touches chalk (SPEC "Degraded environments": never colored, never
   * spun).
   */
  const out = json
    ? JSON.stringify(runResultJson(runResult)) + "\n"
    : renderRun(runResult, mode);
  process.stdout.write(out);
  return exitCodeFor(runResult.verdict);
}

/**
 * Scheme validation happens before any network I/O. Schemeless input gets an
 * implicit https:// prefix; non-HTTP schemes are Usage errors (exit 3).
 */
export function validateTarget(rawTarget: string): string | null {
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rawTarget)
    ? rawTarget
    : `https://${rawTarget}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    usageError(`Invalid target: ${rawTarget}`);
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    usageError(`Unsupported scheme: ${parsed.protocol.replace(":", "")}`);
    return null;
  }

  return withScheme;
}

/**
 * Point-check paths validate before any network I/O, like targets. A
 * health path must start with "/" — anything else (empty, relative,
 * absolute URL) is a usage error.
 */
function collectRepeating(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function validatePaths(paths: string[]): string[] | null {
  for (const path of paths) {
    if (!path.startsWith("/")) {
      usageError(`Invalid --path value (must start with "/"): ${path}`);
      return null;
    }
  }
  return paths;
}

function usageError(message: string): void {
  process.stderr.write(chalk.red(message) + "\n");
}

/**
 * Bin entry: never run by the in-process test seam. Detection is
 * realpath-based (extracted for tests): the installed bin is executed
 * through npm's symlinked name (.bin/probe), so argv[1] does NOT end in
 * "cli.js" there — it must resolve to this module file to invoke main().
 */
export function isDirectInvocation(
  argv1: string | undefined,
  moduleUrl: string,
): boolean {
  if (argv1 === undefined) {
    return false;
  }
  try {
    return realpathSync(argv1) === fileURLToPath(moduleUrl);
  } catch {
    return false;
  }
}

if (isDirectInvocation(process.argv[1], import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
