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

// Resolve the HTTP method for a proxy call. An explicit --method must be GET or POST
// (case-insensitive, normalized to upper); anything else is rejected here instead of
// being forwarded as an invalid method the backend answers with an opaque error.
// Without --method, default to POST when there is a request body, else GET.
export function resolveMethod(flags: Record<string, string | boolean>, hasBody: boolean): "GET" | "POST" {
  const raw = flagString(flags, "method");
  if (raw === undefined) {
    return hasBody ? "POST" : "GET";
  }
  const normalized = raw.toUpperCase();
  if (normalized !== "GET" && normalized !== "POST") {
    throw new Error(`Flag --method must be GET or POST (got "${raw}").`);
  }
  return normalized;
}

export function parseJsonFlag(flags: Record<string, string | boolean>) {
  const value = flagString(flags, "json");
  if (!value) {
    return undefined;
  }
  return JSON.parse(value) as unknown;
}

export function parseQueryFlag(flags: Record<string, string | boolean>) {
  const value = flagString(flags, "query");
  if (!value) {
    return undefined;
  }
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--query must be a JSON object");
  }
  return parsed as Record<string, unknown>;
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

// The provider rides the path: /routes/{auto|provider}/{category}/{action}.
export function buildProxyPath(routeId: string, query?: Record<string, unknown>, provider?: string) {
  const parts = routeId.split("/");
  if (parts.length !== 2 || parts.some((part) => !part)) {
    throw new Error("Route id must look like category/action");
  }
  const path = `/routes/${encodeURIComponent(provider ?? "auto")}/${parts.map(encodeURIComponent).join("/")}`;
  if (!query) {
    return path;
  }
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    // Reject anything we can't faithfully serialize as a single URL query value.
    // Silently dropping arrays/objects/null would send the request with missing
    // filters and return unintended results.
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new Error(
        `--query value for "${key}" must be a string, number, or boolean; arrays, objects, and null are not supported. Use --json for structured request bodies.`
      );
    }
    searchParams.set(key, String(value));
  }
  const queryString = searchParams.toString();
  return queryString ? `${path}?${queryString}` : path;
}
