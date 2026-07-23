import { assertOk, requestJson } from "./api.js";
import { CliError } from "./errors.js";
import { assertConcreteProvider, encodeRouteId, type ParsedArgs } from "./utils.js";

export type ProviderSelection = {
  source: "explicit" | "catalog-default";
  provider: string;
  pinnedCommand: string;
};

export type CatalogCandidate = {
  provider: string;
  [key: string]: unknown;
};

export type CatalogRoute = {
  id: string;
  routeKey: string;
  defaultProvider: string;
  defaultCandidateKey?: string;
  candidates: CatalogCandidate[];
  [key: string]: unknown;
};

type CatalogRouteEnvelope = { route: CatalogRoute };
type SelectionCommand = "call" | "quote" | "show";

const PINNED_COMMAND_FLAGS: Record<SelectionCommand, readonly string[]> = {
  call: ["api-url", "json", "query", "method", "name", "wallet", "no-passphrase", "no-credit", "max-usd"],
  quote: ["api-url", "json", "query", "method"],
  show: ["api-url"]
};

const BOOLEAN_PINNED_COMMAND_FLAGS = new Set(["no-passphrase", "no-credit"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function shellArg(value: string) {
  return /^[A-Za-z0-9_./:@+-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

function pinnedCommand(command: SelectionCommand, routeId: string, provider: string, flags: ParsedArgs["flags"]) {
  const parts = ["h402", command, shellArg(routeId), "--provider", shellArg(provider)];
  for (const name of PINNED_COMMAND_FLAGS[command]) {
    const value = flags[name];
    if (value === undefined) continue;
    if (BOOLEAN_PINNED_COMMAND_FLAGS.has(name)) {
      if (value === true || value === "true") parts.push(`--${name}`);
      continue;
    }
    if (typeof value === "string") parts.push(`--${name}`, shellArg(value));
  }
  return parts.join(" ");
}

function selection(
  command: SelectionCommand,
  routeId: string,
  provider: string,
  source: ProviderSelection["source"],
  flags: ParsedArgs["flags"]
): ProviderSelection {
  return {
    source,
    provider,
    pinnedCommand: pinnedCommand(command, routeId, provider, flags)
  };
}

function recoveryCandidates(route: CatalogRoute) {
  const encodedRoute = encodeRouteId(route.id);
  return route.candidates.map((candidate) => ({
    provider: candidate.provider,
    ...(typeof candidate.candidateKey === "string" ? { candidateKey: candidate.candidateKey } : {}),
    ...(typeof candidate.status === "string" ? { status: candidate.status } : {}),
    path: `/routes/${encodeURIComponent(candidate.provider)}/${encodedRoute}`
  }));
}

function invalidCatalogResponse(routeId: string, message: string, detail?: unknown): never {
  throw new CliError(`Catalog detail for ${routeId} is invalid: ${message}`, {
    error: { code: "invalid_catalog_response", message },
    routeId,
    ...(detail === undefined ? {} : { detail })
  });
}

function parseCatalogRoute(routeId: string, body: unknown): CatalogRoute {
  if (!isRecord(body) || !isRecord(body.route)) {
    return invalidCatalogResponse(routeId, "expected a route object");
  }
  const route = body.route;
  if (typeof route.id !== "string" || route.id !== routeId) {
    return invalidCatalogResponse(routeId, "id does not match the requested route", { id: route.id });
  }
  if (typeof route.defaultProvider !== "string" || !route.defaultProvider) {
    return invalidCatalogResponse(routeId, "defaultProvider is missing");
  }
  try {
    assertConcreteProvider(route.defaultProvider);
  } catch (error) {
    return invalidCatalogResponse(routeId, "defaultProvider is not a concrete provider slug", {
      defaultProvider: route.defaultProvider,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
  if (!Array.isArray(route.candidates) || route.candidates.length === 0) {
    return invalidCatalogResponse(routeId, "enabled candidates are missing");
  }
  const candidates: CatalogCandidate[] = route.candidates.map((candidate, index) => {
    if (!isRecord(candidate) || typeof candidate.provider !== "string" || !candidate.provider) {
      return invalidCatalogResponse(routeId, `candidate ${index} lacks provider`);
    }
    try {
      assertConcreteProvider(candidate.provider);
    } catch (error) {
      return invalidCatalogResponse(routeId, `candidate ${index} has an invalid provider slug`, {
        provider: candidate.provider,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
    return candidate as CatalogCandidate;
  });
  if (!candidates.some((candidate) => candidate.provider === route.defaultProvider && candidate.status === "enabled")) {
    return invalidCatalogResponse(routeId, "defaultProvider is not an enabled candidate", {
      defaultProvider: route.defaultProvider,
      candidates: recoveryCandidates({ ...(route as CatalogRoute), candidates })
    });
  }
  return { ...(route as CatalogRoute), candidates };
}

export async function fetchCatalogRoute(apiUrl: string, routeId: string): Promise<CatalogRouteEnvelope> {
  const body = assertOk(await requestJson<unknown>(apiUrl, `/api/catalog/routes/${encodeRouteId(routeId)}`));
  return { route: parseCatalogRoute(routeId, body) };
}

export async function resolveProvider(
  apiUrl: string,
  routeId: string,
  explicitProvider: string | undefined,
  command: "call" | "quote",
  flags: ParsedArgs["flags"]
): Promise<{ selection: ProviderSelection; route?: CatalogRoute }> {
  if (explicitProvider !== undefined) {
    return { selection: selection(command, routeId, assertConcreteProvider(explicitProvider), "explicit", flags) };
  }
  const { route } = await fetchCatalogRoute(apiUrl, routeId);
  return {
    route,
    selection: selection(command, routeId, route.defaultProvider, "catalog-default", flags)
  };
}

export function selectCatalogCandidate(route: CatalogRoute, provider: string) {
  const candidate = route.candidates.find((item) => item.provider === provider);
  if (candidate) {
    return candidate;
  }
  const message = `Provider "${provider}" is not enabled for ${route.id}.`;
  throw new CliError(message, {
    error: {
      code: "provider_unavailable",
      message,
      routeId: route.id,
      requestedProvider: provider,
      defaultProvider: route.defaultProvider,
      candidates: recoveryCandidates(route)
    }
  });
}

export function explicitShowSelection(routeId: string, provider: string, flags: ParsedArgs["flags"]) {
  return selection("show", routeId, provider, "explicit", flags);
}

export function withProviderSelection(body: unknown, providerSelection: ProviderSelection) {
  if (isRecord(body)) {
    const h402 = isRecord(body.h402) ? body.h402 : {};
    return { ...body, h402: { ...h402, cliProviderSelection: providerSelection } };
  }
  return { data: body, h402: { cliProviderSelection: providerSelection } };
}

export function withProviderSelectionError(error: unknown, providerSelection: ProviderSelection) {
  const existingDetail = error instanceof CliError && isRecord(error.detail) ? error.detail : {};
  const h402 = isRecord(existingDetail.h402) ? existingDetail.h402 : {};
  return new CliError(error instanceof Error ? error.message : String(error), {
    ...existingDetail,
    h402: { ...h402, cliProviderSelection: providerSelection }
  });
}
