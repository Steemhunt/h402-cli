import { Agent } from "undici";
import { CliError } from "./errors.js";

export const H402_HTTP_TIMEOUT_MS = 450_000;

const h402FetchDispatcher = new Agent({
  headersTimeout: H402_HTTP_TIMEOUT_MS,
  bodyTimeout: H402_HTTP_TIMEOUT_MS
});

type FetchInitWithDispatcher = RequestInit & { dispatcher?: Agent; token?: string };

export type ApiResponse<T> = {
  status: number;
  statusText: string;
  body: T;
  headers: Headers;
};

export async function requestJson<T>(
  backendUrl: string,
  path: string,
  init: FetchInitWithDispatcher = {}
): Promise<ApiResponse<T>> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  if (init.token) {
    headers.set("authorization", `Bearer ${init.token}`);
  }

  const fetchInit: FetchInitWithDispatcher = { ...init };
  delete fetchInit.token;
  const response = await fetch(`${backendUrl}${path}`, {
    ...fetchInit,
    headers,
    dispatcher: fetchInit.dispatcher ?? h402FetchDispatcher
  } as RequestInit);

  const text = await response.text();
  let body: T;
  try {
    body = text ? (JSON.parse(text) as T) : (null as T);
  } catch {
    // A non-JSON body (an HTML 502 page, a plain-text gateway error) must not crash the
    // parse — keep the raw text so assertOk can surface it instead of throwing here.
    body = text as unknown as T;
  }
  return { status: response.status, statusText: response.statusText, body, headers: response.headers };
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

export function assertOk<T>(response: ApiResponse<T>): T {
  if (response.status < 200 || response.status >= 300) {
    const { body } = response;
    const statusLine = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
    // Empty body (a framework 405, an infra 502/504): status only — never the literal "null".
    if (body === null || body === undefined || body === "") {
      throw new CliError(`Request failed: ${statusLine}`);
    }
    // Non-JSON string body (an HTML 502 page, a plain-text gateway error): show it verbatim.
    if (typeof body === "string") {
      throw new CliError(`Request failed: ${statusLine}: ${body}`);
    }
    // Structured JSON error: summarize its message, and carry the full body as `detail`
    // so the stderr error envelope stays machine-readable.
    const message = backendMessage(body);
    throw new CliError(message ? `Request failed: ${statusLine}: ${message}` : `Request failed: ${statusLine}`, body);
  }
  return response.body;
}
