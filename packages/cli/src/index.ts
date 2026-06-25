#!/usr/bin/env node
import {
  authCommand,
  callCommand,
  creditsCommand,
  quoteCommand,
  searchCommand,
  walletCommand
} from "./commands.js";
import { assertKnownFlags, commandHelp, getVersion, isKnownCommand, resolveCommandPath, topLevelHelp } from "./help.js";
import { flagBoolean, parseArgs } from "./utils.js";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positional[0];

  if (flagBoolean(args.flags, "version") || command === "version") {
    process.stdout.write(`${getVersion()}\n`);
    return;
  }

  if (!command || command === "help") {
    process.stdout.write(`${topLevelHelp()}\n`);
    return;
  }

  if (!isKnownCommand(command)) {
    throw new Error(`Unknown command: ${command}. Run: h402 --help`);
  }

  const commandPath = resolveCommandPath(args.positional);

  if (flagBoolean(args.flags, "help")) {
    process.stdout.write(`${commandHelp(commandPath)}\n`);
    return;
  }

  // Reject typo'd/unsupported flags before doing any work (a silently ignored
  // --idempotency-key on a paid call could double-charge on retry).
  assertKnownFlags(commandPath, args.flags);

  if (command === "wallet") return walletCommand(args);
  if (command === "auth") return authCommand(args);
  if (command === "credits") return creditsCommand(args);
  if (command === "search") return searchCommand(args);
  if (command === "quote") return quoteCommand(args);
  if (command === "call") return callCommand(args);

  throw new Error(`Unknown command: ${command}. Run: h402 --help`);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
