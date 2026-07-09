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

    const rawName = value.slice(2);
    const equalsIndex = rawName.indexOf("=");
    if (equalsIndex >= 0) {
      flags[rawName.slice(0, equalsIndex)] = rawName.slice(equalsIndex + 1);
      continue;
    }

    const name = rawName;
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
  if (normalized === "GET" && hasBody) {
    throw new Error("Flag --method GET cannot be combined with --json; GET requests must use --query for URL parameters.");
  }
  return normalized;
}

function flagValue(flags: Record<string, string | boolean>, name: string) {
  const value = flags[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value === "") {
    throw new Error(`Flag --${name} requires a value.`);
  }
  return value;
}

function jsonParseMessage(flag: "json" | "query", value: string, example: string, error: unknown) {
  const parserMessage = error instanceof Error ? error.message : String(error);
  const keyValueHint = flag === "query" && /^[^=\s]+=/.test(value) ? " key=value syntax is not supported;" : "";
  return `Flag --${flag} must be ${flag === "query" ? "a JSON object" : "valid JSON"}, e.g. --${flag} '${example}' (got ${JSON.stringify(value)};${keyValueHint} ${parserMessage}).`;
}

export function parseJsonFlag(flags: Record<string, string | boolean>) {
  const value = flagValue(flags, "json");
  if (value === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(jsonParseMessage("json", value, '{"query":"Seoul"}', error));
  }
}

export function parseQueryFlag(flags: Record<string, string | boolean>) {
  const value = flagValue(flags, "query");
  if (value === undefined) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(jsonParseMessage("query", value, '{"q":"Seoul"}', error));
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Flag --query must be a JSON object, e.g. --query '{"q":"Seoul"}' (got ${JSON.stringify(value)}).`);
  }
  return parsed as Record<string, unknown>;
}

function writeStream(stream: NodeJS.WritableStream, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      stream.off("drain", onDrain);
      reject(error);
    };
    const onDrain = () => {
      stream.off("error", onError);
      resolve();
    };

    stream.once("error", onError);
    if (stream.write(text)) {
      stream.off("error", onError);
      resolve();
      return;
    }
    stream.once("drain", onDrain);
  });
}

export function writeStdout(text: string): Promise<void> {
  return writeStream(process.stdout, text);
}

export function writeStderr(text: string): Promise<void> {
  return writeStream(process.stderr, text);
}

export function printJson(data: unknown): Promise<void> {
  return writeStdout(`${JSON.stringify(data, null, 2)}\n`);
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
