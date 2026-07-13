import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// One spec per command drives BOTH the rendered help and unknown-flag rejection,
// so they can never drift apart. `valueOptional` marks a value flag whose bare
// form is meaningful (e.g. bare --passphrase = "prompt me").
type Flag = { name: string; value?: string; valueOptional?: boolean; desc: string };
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
  passphrase: {
    name: "passphrase",
    value: "[<s>]",
    valueOptional: true,
    desc: "Passphrase for a passphrase-protected wallet; omit the value to be prompted (or H402_WALLET_PASSPHRASE)"
  },
  noPassphrase: { name: "no-passphrase", desc: "Force passphrase-less signing even if H402_WALLET_PASSPHRASE is set (the default needs no flag)" },
  noCredit: { name: "no-credit", desc: "Ignore bonus credits and pay x402 only" },
  maxUsd: { name: "max-usd", value: "<usd>", desc: "Refuse to sign if the x402 USDC amount exceeds this cap" },
  idempotencyKey: { name: "idempotency-key", value: "<uuid>", desc: "Stable key for safe retries (default: random)" },
  limit: { name: "limit", value: "<n>", desc: "Max results (default 20)" }
} satisfies Record<string, Flag>;

export const COMMANDS: Record<string, CommandSpec> = {
  wallet: {
    usage: "h402 wallet <create|list|restore|address|balance|fund> [flags]",
    summary: "Manage local non-custodial wallets",
    flags: [],
    subcommands: {
      create: {
        usage: "h402 wallet create [flags]",
        summary: "Create a local OWS signing wallet (no auth session; passphrase-less by default; prints its address)",
        flags: [FLAGS.name, FLAGS.passphrase, FLAGS.noPassphrase],
        examples: ["h402 wallet create --name agent"]
      },
      list: { usage: "h402 wallet list", summary: "List OWS wallets", flags: [] },
      restore: { usage: "h402 wallet restore", summary: "Re-adopt OWS wallets into h402 config", flags: [] },
      address: { usage: "h402 wallet address [flags]", summary: "Print a wallet address", flags: [FLAGS.name, FLAGS.wallet] },
      balance: {
        usage: "h402 wallet balance [flags]",
        summary: "Show a wallet's Base USDC balance",
        flags: [FLAGS.name, FLAGS.wallet],
        examples: ["h402 wallet balance --name agent"]
      },
      fund: { usage: "h402 wallet fund [flags]", summary: "Print the Base USDC deposit address for a wallet", flags: [FLAGS.name, FLAGS.wallet] }
    }
  },
  auth: {
    usage: "h402 auth [flags]",
    summary: "Create a backend bonus-credit session with a wallet signature",
    flags: [FLAGS.name, FLAGS.wallet, FLAGS.apiUrl, FLAGS.passphrase, FLAGS.noPassphrase]
  },
  credits: { usage: "h402 credits [flags]", summary: "Show the bonus-credit balance for the signed-in session", flags: [FLAGS.apiUrl] },
  search: {
    usage: "h402 search <query> [flags]",
    summary: "Search the catalog without a wallet (JSON results)",
    flags: [FLAGS.apiUrl, FLAGS.limit],
    examples: ['h402 search "web search"']
  },
  quote: {
    usage: "h402 quote <category/action> [flags]",
    summary: "Preview the x402 PAYMENT-REQUIRED envelope without paying or a wallet",
    flags: [FLAGS.apiUrl, FLAGS.json, FLAGS.query, FLAGS.provider, FLAGS.method],
    examples: ["h402 quote web/search --json '{\"query\":\"agent APIs\"}'"]
  },
  call: {
    usage: "h402 call <category/action> [flags]",
    summary: "Execute a route and pay if challenged (free routes need no wallet)",
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
      FLAGS.maxUsd,
      FLAGS.idempotencyKey
    ],
    examples: ["h402 call ai/news", "h402 call web/search --name agent --json '{\"query\":\"agent APIs\"}'"]
  }
};

const ENV_VARS: [string, string][] = [
  ["H402_API_URL", "Backend base URL override (or --api-url)"],
  ["H402_WALLET_PASSPHRASE", "Passphrase for passphrase-protected wallets (only needed when the wallet was created with one)"]
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

function unknownFlagsError(names: string[], helpCommand: string): Error {
  const label = names.length > 1 ? "Unknown flags" : "Unknown flag";
  return new Error(`${label}: ${names.map((name) => `--${name}`).join(", ")}. Run: ${helpCommand}`);
}

// Reject flags the resolved command doesn't accept (so a typo like
// --idempotency-ky fails loudly), and validate value shape: a value flag must
// carry a value, a boolean flag must not. A bare value flag parses to boolean
// `true`, which flagString() silently treats as unset — e.g. `--idempotency-key`
// with no value would fall back to a random key, making a paid retry unsafe.
export function assertKnownFlags(commandPath: string[], flags: Record<string, string | boolean>): void {
  const spec = specFor(commandPath);
  if (!spec) {
    return; // Unknown command/subcommand: the command handler reports it.
  }
  // Flag name -> value arity (--help is an always-allowed boolean). "optional"
  // flags are meaningful both bare and with a value (bare --passphrase = prompt).
  const valueFlags = new Map<string, "required" | "optional" | "none">([["help", "none"]]);
  for (const flag of spec.flags) {
    valueFlags.set(flag.name, flag.value === undefined ? "none" : flag.valueOptional ? "optional" : "required");
  }

  const unknown = Object.keys(flags).filter((key) => !valueFlags.has(key));
  if (unknown.length > 0) {
    throw unknownFlagsError(unknown, `h402 ${commandPath.join(" ")} --help`);
  }

  for (const [name, provided] of Object.entries(flags)) {
    const arity = valueFlags.get(name);
    if (arity === "required" && typeof provided !== "string") {
      throw new Error(`Flag --${name} requires a value. Run: h402 ${commandPath.join(" ")} --help`);
    }
    // A boolean flag that captured a following token (e.g. `--no-passphrase web/search`,
    // where the parser greedily consumed the route id) is a mistake; "true" stays
    // valid since flagBoolean() accepts it.
    if (arity === "none" && typeof provided === "string" && provided !== "true") {
      throw new Error(`Flag --${name} does not take a value (got "${provided}"). Run: h402 ${commandPath.join(" ")} --help`);
    }
  }
}

// Without a command, only --help and --version are valid; reject anything else
// (e.g. a typo'd --versoin) instead of silently printing help and exiting 0.
export function assertTopLevelFlags(flags: Record<string, string | boolean>): void {
  const stray = Object.keys(flags).filter((flag) => flag !== "help" && flag !== "version");
  if (stray.length > 0) {
    throw unknownFlagsError(stray, "h402 --help");
  }
}
