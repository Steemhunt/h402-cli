export type ApiResponse<T> = {
  status: number;
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
  const body = text ? (JSON.parse(text) as T) : (null as T);
  return { status: response.status, body, headers: response.headers };
}

export function assertOk<T>(response: ApiResponse<T>) {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(JSON.stringify(response.body, null, 2));
  }
  return response.body;
}
