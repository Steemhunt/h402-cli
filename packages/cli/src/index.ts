#!/usr/bin/env node
import {
  authCommand,
  callCommand,
  creditsCommand,
  quoteCommand,
  searchCommand,
  showCommand,
  walletCommand
} from "./commands.js";
import { errorEnvelope } from "./errors.js";
import { assertKnownFlags, assertTopLevelFlags, commandHelp, getVersion, isKnownCommand, resolveCommandPath, topLevelHelp } from "./help.js";
import { flagBoolean, parseArgs, writeStderr, writeStdout } from "./utils.js";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positional[0];

  if (flagBoolean(args.flags, "version") || command === "version") {
    await writeStdout(`${getVersion()}\n`);
    return;
  }

  if (!command || command === "help") {
    assertTopLevelFlags(args.flags);
    await writeStdout(`${topLevelHelp()}\n`);
    return;
  }

  if (!isKnownCommand(command)) {
    throw new Error(`Unknown command: ${command}. Run: h402 --help`);
  }

  const commandPath = resolveCommandPath(args.positional);

  if (flagBoolean(args.flags, "help")) {
    await writeStdout(`${commandHelp(commandPath)}\n`);
    return;
  }

  // Reject typo'd/unsupported flags before doing any work (a silently ignored
  // --idempotency-key on a paid call could double-charge on retry).
  assertKnownFlags(commandPath, args.flags);

  if (command === "wallet") return walletCommand(args);
  if (command === "auth") return authCommand(args);
  if (command === "credits") return creditsCommand(args);
  if (command === "search") return searchCommand(args);
  if (command === "show") return showCommand(args);
  if (command === "quote") return quoteCommand(args);
  if (command === "call") return callCommand(args);

  throw new Error(`Unknown command: ${command}. Run: h402 --help`);
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch(async (error) => {
    // Every failure exits non-zero with one machine-readable stderr shape:
    // { "error": { "message", "detail"? } } (see errorEnvelope).
    process.exitCode = 1;
    await writeStderr(`${JSON.stringify(errorEnvelope(error), null, 2)}\n`);
  });
