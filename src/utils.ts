export type ParsedArgs = {
  positional: string[];
  flags: Record<string, string | boolean>;
};

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }

    const name = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags[name] = true;
      continue;
    }

    flags[name] = next;
    index += 1;
  }

  return { positional, flags };
}

export function flagString(flags: Record<string, string | boolean>, name: string, fallback?: string) {
  const value = flags[name];
  if (typeof value === "string") {
    return value;
  }
  return fallback;
}

export function flagBoolean(flags: Record<string, string | boolean>, name: string) {
  return flags[name] === true || flags[name] === "true";
}

export function parseJsonFlag(flags: Record<string, string | boolean>) {
  const value = flagString(flags, "json");
  if (!value) {
    return undefined;
  }
  return JSON.parse(value) as unknown;
}

export function printJson(data: unknown) {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

export function requireValue<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null || value === "") {
    throw new Error(message);
  }
  return value;
}

export function buildProxyPath(routeId: string) {
  const parts = routeId.split("/");
  if (parts.length !== 2 || parts.some((part) => !part)) {
    throw new Error("Route id must look like category/action");
  }
  return `/api/proxy/${parts.map(encodeURIComponent).join("/")}`;
}
