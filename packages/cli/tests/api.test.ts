import { afterEach, describe, expect, it, vi } from "vitest";
import { H402_HTTP_TIMEOUT_MS, requestJson } from "../src/api";
import { CliError } from "../src/errors";

function response(status: number, body: unknown) {
  return {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers(),
    text: async () => JSON.stringify(body)
  };
}

describe("requestJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses an explicit long undici timeout for slow paid calls", async () => {
    const fetch = vi.fn(async (...args: unknown[]) => {
      expect(args.length).toBeGreaterThan(0);
      return response(200, { ok: true });
    });
    vi.stubGlobal("fetch", fetch);

    await expect(requestJson("https://api.example", "/routes/auto/web/search")).resolves.toMatchObject({ status: 200, body: { ok: true } });

    expect(H402_HTTP_TIMEOUT_MS).toBeGreaterThanOrEqual(450_000);
    const init = fetch.mock.calls[0]?.[1] as { dispatcher?: unknown } | undefined;
    expect(init?.dispatcher).toBeTruthy();
  });

  it("does not forward the CLI-only token option into fetch init", async () => {
    const fetch = vi.fn(async (...args: unknown[]) => {
      expect(args.length).toBeGreaterThan(0);
      return response(200, { ok: true });
    });
    vi.stubGlobal("fetch", fetch);

    await requestJson("https://api.example", "/api/me", { token: "session-token" });

    const init = fetch.mock.calls[0]?.[1] as { token?: string; headers?: Headers } | undefined;
    expect(init?.token).toBeUndefined();
    expect(init?.headers?.get("authorization")).toBe("Bearer session-token");
  });

  it("names the attempted URL and network cause when fetch rejects", async () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const failure = new TypeError("fetch failed") as TypeError & { cause?: unknown };
    failure.cause = cause;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw failure;
      })
    );

    const error = await requestJson("http://127.0.0.1:9", "/api/catalog/search?q=x").catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(CliError);
    expect(error).toMatchObject({ message: "Request to http://127.0.0.1:9/api/catalog/search?q=x failed: ECONNREFUSED" });
  });
});
