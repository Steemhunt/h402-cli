import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// One spec per command drives BOTH the rendered help and unknown-flag rejection,
// so they can never drift apart.
type Flag = { name: string; value?: string; desc: string };
type CommandSpec = {
  usage: string;
  summary: string;
  flags: Flag[];
  examples?: string[];
  subcommands?: Record<string, CommandSpec>;
};

// Reusable flag definitions (DRY: declared once, referenced by each command that
// accepts them — mirrors the README flags table).
const FLAGS = {
  name: { name: "name", value: "<wallet>", desc: "Wallet to use (default h402)" },
  wallet: { name: "wallet", value: "0x...", desc: "Local wallet that owns this address (must agree with --name)" },
  apiUrl: { name: "api-url", value: "<url>", desc: "Backend base URL (or H402_API_URL; default https://h402.hunt.town)" },
  json: { name: "json", value: "'{...}'", desc: "Request body (sets method to POST)" },
  query: { name: "query", value: "'{...}'", desc: "URL query params; values must be string/number/boolean" },
  provider: { name: "provider", value: "<name>", desc: "Pin a provider (default auto)" },
  method: { name: "method", value: "GET|POST", desc: "Override the HTTP method" },
  passphrase: { name: "passphrase", value: "<s>", desc: "Signing passphrase (or H402_WALLET_PASSPHRASE)" },
  noPassphrase: { name: "no-passphrase", desc: "Sign without a passphrase (disposable wallets only)" },
  noCredit: { name: "no-credit", desc: "Ignore bonus credits and pay x402 only" },
  idempotencyKey: { name: "idempotency-key", value: "<uuid>", desc: "Stable key for safe retries (default: random)" },
  limit: { name: "limit", value: "<n>", desc: "Max results (default 20)" }
} satisfies Record<string, Flag>;

export const COMMANDS: Record<string, CommandSpec> = {
  wallet: {
    usage: "h402 wallet <create|address|balance|fund> [flags]",
    summary: "Manage local non-custodial wallets",
    flags: [],
    subcommands: {
      create: {
        usage: "h402 wallet create [flags]",
        summary: "Create a local OWS wallet (prints its address)",
        flags: [FLAGS.name, FLAGS.passphrase, FLAGS.noPassphrase],
        examples: ["h402 wallet create --name agent --no-passphrase"]
      },
      address: { usage: "h402 wallet address [flags]", summary: "Print a wallet address", flags: [FLAGS.name, FLAGS.wallet] },
      balance: {
        usage: "h402 wallet balance [flags]",
        summary: "Show a wallet's Base USDC balance",
        flags: [FLAGS.name, FLAGS.wallet],
        examples: ["h402 wallet balance --name agent"]
      },
      fund: { usage: "h402 wallet fund [flags]", summary: "Open the OWS deposit flow to fund a wallet", flags: [FLAGS.name, FLAGS.wallet] }
    }
  },
  auth: {
    usage: "h402 auth [flags]",
    summary: "Sign in to a backend with a wallet signature (enables bonus credits)",
    flags: [FLAGS.name, FLAGS.wallet, FLAGS.apiUrl, FLAGS.passphrase, FLAGS.noPassphrase]
  },
  credits: { usage: "h402 credits [flags]", summary: "Show the bonus-credit balance for the signed-in session", flags: [FLAGS.apiUrl] },
  search: {
    usage: "h402 search <query> [flags]",
    summary: "Search the catalog (JSON results)",
    flags: [FLAGS.apiUrl, FLAGS.limit],
    examples: ['h402 search "web search"']
  },
  quote: {
    usage: "h402 quote <category/action> [flags]",
    summary: "Preview the x402 PAYMENT-REQUIRED envelope without paying",
    flags: [FLAGS.apiUrl, FLAGS.json, FLAGS.query, FLAGS.provider, FLAGS.method],
    examples: ["h402 quote web/search --json '{\"query\":\"agent APIs\"}'"]
  },
  call: {
    usage: "h402 call <category/action> [flags]",
    summary: "Execute a paid proxy call (signs + retries on 402)",
    flags: [
      FLAGS.name,
      FLAGS.wallet,
      FLAGS.apiUrl,
      FLAGS.json,
      FLAGS.query,
      FLAGS.provider,
      FLAGS.method,
      FLAGS.passphrase,
      FLAGS.noPassphrase,
      FLAGS.noCredit,
      FLAGS.idempotencyKey
    ],
    examples: ["h402 call web/search --name agent --no-passphrase --json '{\"query\":\"agent APIs\",\"limit\":5}'"]
  }
};

const ENV_VARS: [string, string][] = [
  ["H402_API_URL", "Backend base URL override (or --api-url)"],
  ["H402_OWS_BIN", "Path to the OWS binary (defaults to the bundled copy, then PATH)"],
  ["H402_WALLET_PASSPHRASE", "Non-interactive passphrase for signing"]
];

export function getVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const manifest = JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf8")) as { version: string };
  return manifest.version;
}

export function isKnownCommand(command: string): boolean {
  return Object.hasOwn(COMMANDS, command);
}

export function specFor(commandPath: string[]): CommandSpec | undefined {
  const [command, subcommand] = commandPath;
  const top = command ? COMMANDS[command] : undefined;
  if (!top) {
    return undefined;
  }
  if (subcommand && top.subcommands && Object.hasOwn(top.subcommands, subcommand)) {
    return top.subcommands[subcommand];
  }
  return top;
}

// The deepest known command/subcommand the positionals name (e.g. ["wallet",
// "balance"]); an unknown subcommand falls back to the command itself.
export function resolveCommandPath(positional: string[]): string[] {
  const [command, maybeSub] = positional;
  if (!command || !isKnownCommand(command)) {
    return command ? [command] : [];
  }
  const spec = COMMANDS[command];
  if (spec.subcommands && maybeSub && Object.hasOwn(spec.subcommands, maybeSub)) {
    return [command, maybeSub];
  }
  return [command];
}

function renderFlag(flag: Flag): string {
  const left = flag.value ? `--${flag.name} ${flag.value}` : `--${flag.name}`;
  return `  ${left.padEnd(28)} ${flag.desc}`;
}

export function topLevelHelp(): string {
  const lines = ["h402 — the x402 router for agent capabilities", "", "Usage: h402 <command> [flags]", "", "Commands:"];
  for (const [name, spec] of Object.entries(COMMANDS)) {
    lines.push(`  ${name.padEnd(10)} ${spec.summary}`);
  }
  lines.push("", "Run 'h402 <command> --help' for details, 'h402 --version' for the version.", "", "Environment:");
  for (const [name, desc] of ENV_VARS) {
    lines.push(`  ${name.padEnd(24)} ${desc}`);
  }
  return lines.join("\n");
}

export function commandHelp(commandPath: string[]): string {
  const spec = specFor(commandPath);
  if (!spec) {
    return topLevelHelp();
  }
  const lines = [spec.summary, "", `Usage: ${spec.usage}`];
  if (spec.subcommands) {
    lines.push("", "Subcommands:");
    for (const [name, sub] of Object.entries(spec.subcommands)) {
      lines.push(`  ${name.padEnd(10)} ${sub.summary}`);
    }
  }
  lines.push("", "Flags:");
  for (const flag of spec.flags) {
    lines.push(renderFlag(flag));
  }
  lines.push(renderFlag({ name: "help", desc: "Print this help" }));
  if (spec.examples?.length) {
    lines.push("", "Examples:");
    for (const example of spec.examples) {
      lines.push(`  ${example}`);
    }
  }
  return lines.join("\n");
}

// Reject flags the resolved command doesn't accept, so a typo (e.g.
// --idempotency-ky on a paid call) fails loudly instead of being ignored.
export function assertKnownFlags(commandPath: string[], flags: Record<string, string | boolean>): void {
  const spec = specFor(commandPath);
  if (!spec) {
    return; // Unknown command/subcommand: the command handler reports it.
  }
  const allowed = new Set<string>(["help", ...spec.flags.map((flag) => flag.name)]);
  const unknown = Object.keys(flags).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    const label = unknown.length > 1 ? "Unknown flags" : "Unknown flag";
    throw new Error(`${label}: ${unknown.map((flag) => `--${flag}`).join(", ")}. Run: h402 ${commandPath.join(" ")} --help`);
  }
}
