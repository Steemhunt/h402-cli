import { Agent } from "undici";
import { CliError } from "./errors.js";
import { getVersion } from "./help.js";

export const H402_HTTP_TIMEOUT_MS = 450_000;

const h402FetchDispatcher = new Agent({
  headersTimeout: H402_HTTP_TIMEOUT_MS,
  bodyTimeout: H402_HTTP_TIMEOUT_MS
});

type FetchInitWithDispatcher = RequestInit & { dispatcher?: Agent; token?: string };

export type ApiResponse<T> = {
  backendUrl: string;
  url: string;
  status: number;
  statusText: string;
  body: T;
  headers: Headers;
};

function networkErrorMessage(error: unknown) {
  const cause = error && typeof error === "object" ? (error as { cause?: unknown }).cause : undefined;
  if (cause && typeof cause === "object") {
    const code = (cause as { code?: unknown }).code;
    if (typeof code === "string" && code) {
      return code;
    }
    const message = (cause as { message?: unknown }).message;
    if (typeof message === "string" && message) {
      return message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export async function requestJson<T>(
  backendUrl: string,
  path: string,
  init: FetchInitWithDispatcher = {}
): Promise<ApiResponse<T>> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (!headers.has("user-agent")) {
    headers.set("user-agent", `h402-cli/${getVersion()}`);
  }

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  if (init.token) {
    headers.set("authorization", `Bearer ${init.token}`);
  }

  const fetchInit: FetchInitWithDispatcher = { ...init };
  delete fetchInit.token;
  const url = `${backendUrl}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      ...fetchInit,
      headers,
      dispatcher: fetchInit.dispatcher ?? h402FetchDispatcher
    } as RequestInit);
  } catch (error) {
    throw new CliError(`Request to ${url} failed: ${networkErrorMessage(error)}`, { backendUrl, url });
  }

  const text = await response.text();
  let body: T;
  try {
    body = text ? (JSON.parse(text) as T) : (null as T);
  } catch {
    // A non-JSON body (an HTML 502 page, a plain-text gateway error) must not crash the
    // parse — keep the raw text so assertOk can surface it instead of throwing here.
    body = text as unknown as T;
  }
  return { backendUrl, url, status: response.status, statusText: response.statusText, body, headers: response.headers };
}

function responseContext<T>(response: ApiResponse<T>) {
  return { backendUrl: response.backendUrl, url: response.url };
}

function responseErrorDetail<T>(response: ApiResponse<T>): unknown {
  const context = responseContext(response);
  const { body } = response;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return { ...(body as Record<string, unknown>), ...context };
  }
  return context;
}

// Pull a human-readable message out of a backend error body — covering the common
// { error: { message } }, { error: "..." }, and { message } shapes — so the stderr
// envelope's `message` is useful even before a caller inspects `detail`.
function backendMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string") {
    return (error as Record<string, unknown>).message as string;
  }
  return typeof record.message === "string" ? record.message : undefined;
}

function backendErrorCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  const error = record.error;
  if (error && typeof error === "object" && typeof (error as Record<string, unknown>).code === "string") {
    return (error as Record<string, unknown>).code as string;
  }
  return typeof record.code === "string" ? record.code : undefined;
}

function idempotencyGuidance(body: unknown): string | undefined {
  const code = backendErrorCode(body);
  if (code !== "idempotency_key_already_used" && code !== "idempotency_key_in_progress") {
    return undefined;
  }
  return "The earlier request for this idempotency key may already be completed, charged, or still settling; do NOT sign or pay with a new idempotency key unless you intentionally accept a second charge.";
}

export function assertOk<T>(response: ApiResponse<T>): T {
  if (response.status < 200 || response.status >= 300) {
    const { body } = response;
    const statusLine = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
    // Empty body (a framework 405, an infra 502/504): status only — never the literal "null".
    if (body === null || body === undefined || body === "") {
      throw new CliError(`Request failed: ${statusLine}`, responseContext(response));
    }
    // Non-JSON string body (an HTML 502 page, a plain-text gateway error): show it verbatim.
    if (typeof body === "string") {
      throw new CliError(`Request failed: ${statusLine}: ${body}`, responseContext(response));
    }
    // Structured JSON error: summarize its message, and carry the full body as `detail`
    // so the stderr error envelope stays machine-readable.
    const message = backendMessage(body);
    const guidance = idempotencyGuidance(body);
    const summary = message ? `Request failed: ${statusLine}: ${message}` : `Request failed: ${statusLine}`;
    throw new CliError(guidance ? `${summary}. ${guidance}` : summary, responseErrorDetail(response));
  }
  return response.body;
}
