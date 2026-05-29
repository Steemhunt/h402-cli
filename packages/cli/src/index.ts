#!/usr/bin/env node
import {
  authCommand,
  callCommand,
  creditsCommand,
  delegationCommand,
  quoteCommand,
  searchCommand,
  walletCommand
} from "./commands.js";
import { parseArgs } from "./utils.js";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positional[0];

  if (!command || command === "help" || command === "--help") {
    process.stdout.write(`h402 CLI

Commands:
  wallet create|address|balance|fund
  auth
  credits
  delegation list|save|delete
  search <query>
  quote <category/action>
  call <category/action>

Common flags:
  --name h402
  --wallet 0x...
  --api-url http://localhost:3000
  --json '{"query":"agent APIs"}'
  --query '{"placeId":"ChIJ..."}'
  --provider exa
  --no-passphrase
`);
    return;
  }

  if (command === "wallet") return walletCommand(args);
  if (command === "auth") return authCommand(args);
  if (command === "credits") return creditsCommand(args);
  if (command === "delegation") return delegationCommand(args);
  if (command === "search") return searchCommand(args);
  if (command === "quote") return quoteCommand(args);
  if (command === "call") return callCommand(args);

  throw new Error(`Unknown command: ${command}`);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
