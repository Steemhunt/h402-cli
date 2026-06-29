export type ApiResponse<T> = {
  status: number;
  statusText: string;
  body: T;
  headers: Headers;
};

export async function requestJson<T>(
  backendUrl: string,
  path: string,
  init: RequestInit & { token?: string } = {}
): Promise<ApiResponse<T>> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  if (init.token) {
    headers.set("authorization", `Bearer ${init.token}`);
  }

  const response = await fetch(`${backendUrl}${path}`, {
    ...init,
    headers
  });

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

export function assertOk<T>(response: ApiResponse<T>) {
  if (response.status < 200 || response.status >= 300) {
    const { body } = response;
    const statusLine = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
    // An empty body (a framework 405, an infra 502/504) would otherwise stringify to the
    // useless literal "null"; surface the HTTP status so the failure is diagnosable.
    if (body === null || body === undefined || body === "") {
      throw new Error(`Request failed: ${statusLine}`);
    }
    // A non-JSON string body is shown verbatim; a structured JSON error keeps its full
    // shape so callers can still read its code/message.
    if (typeof body === "string") {
      throw new Error(`Request failed: ${statusLine}: ${body}`);
    }
    throw new Error(JSON.stringify(body, null, 2));
  }
  return response.body;
}
