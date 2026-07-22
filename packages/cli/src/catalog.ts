import { assertOk, requestJson } from "./api.js";
import { CliError } from "./errors.js";
import { assertConcreteProvider, encodeRouteId } from "./utils.js";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function shellArg(value: string) {
  return /^[A-Za-z0-9_./:@+-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

function selection(command: "call" | "quote" | "show", routeId: string, provider: string, source: ProviderSelection["source"]): ProviderSelection {
  return {
    source,
    provider,
    pinnedCommand: `h402 ${command} ${shellArg(routeId)} --provider ${shellArg(provider)}`
  };
}

function alternatives(route: CatalogRoute) {
  const encodedRoute = encodeRouteId(route.id);
  return route.candidates.map(({ provider }) => ({
    provider,
    pinnedPath: `/routes/${encodeURIComponent(provider)}/${encodedRoute}`
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
  if (!candidates.some((candidate) => candidate.provider === route.defaultProvider)) {
    return invalidCatalogResponse(routeId, "defaultProvider is not an enabled candidate", {
      defaultProvider: route.defaultProvider,
      alternatives: candidates.map(({ provider }) => ({
        provider,
        pinnedPath: `/routes/${encodeURIComponent(provider)}/${encodeRouteId(routeId)}`
      }))
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
  command: "call" | "quote"
): Promise<{ selection: ProviderSelection; route?: CatalogRoute }> {
  if (explicitProvider !== undefined) {
    return { selection: selection(command, routeId, assertConcreteProvider(explicitProvider), "explicit") };
  }
  const { route } = await fetchCatalogRoute(apiUrl, routeId);
  return {
    route,
    selection: selection(command, routeId, route.defaultProvider, "catalog-default")
  };
}

export function selectCatalogCandidate(route: CatalogRoute, provider: string) {
  const candidate = route.candidates.find((item) => item.provider === provider);
  if (candidate) {
    return candidate;
  }
  const message = `Provider "${provider}" is not enabled for ${route.id}.`;
  throw new CliError(message, {
    error: { code: "unknown_provider", message },
    routeId: route.id,
    requestedProvider: provider,
    defaultProvider: route.defaultProvider,
    alternatives: alternatives(route)
  });
}

export function explicitShowSelection(routeId: string, provider: string) {
  return selection("show", routeId, provider, "explicit");
}

export function withProviderSelection(body: unknown, providerSelection: ProviderSelection) {
  if (isRecord(body)) {
    const h402 = isRecord(body.h402) ? body.h402 : {};
    return { ...body, h402: { ...h402, cliProviderSelection: providerSelection } };
  }
  return { data: body, h402: { cliProviderSelection: providerSelection } };
}
