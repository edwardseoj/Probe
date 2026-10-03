/**
 * cli.ts — one verb, no subcommands: probe <target> [flags].
 * Usage errors (exit 3, ADR-0002) are decided here, in the input-validation
 * path, BEFORE any network I/O — never through the verdict path.
 */

import { Command, CommanderError } from "commander";
import chalk from "chalk";
import { run } from "./run.js";
import { exitCodeFor } from "./verdict.js";
import type { RunOptions } from "./run.js";
import { renderRun } from "./output.js";

export const USAGE_EXIT_CODE = 3;

export async function main(argv: string[]): Promise<number> {
  const program = new Command();
  program
    .name("probe")
    .description("Post-deployment sanity check. Deploy, run Probe, know.")
    .argument("<target>", "HTTP(S) target to check")
    .option("--timeout <seconds>", "Run budget in seconds (default 10)", "10")
    .exitOverride();

  let target: string;
  let timeoutRaw: string;
  try {
    program.parse(argv, { from: "user" });
    target = program.args[0];
    timeoutRaw = program.opts<{ timeout?: string }>().timeout ?? "10";
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

  const options: RunOptions = { timeoutSeconds: timeoutSeconds };
  const runResult = await run(validated, options);
  process.stdout.write(renderRun(runResult));
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

function usageError(message: string): void {
  process.stderr.write(chalk.red(message) + "\n");
}

/** Bin entry: never run by the in-process test seam. */
const invokedDirectly =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("cli.ts") || process.argv[1].endsWith("cli.js"));

if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
