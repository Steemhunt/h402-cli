import { afterEach, describe, expect, it, vi } from "vitest";
import { CliError } from "../src/errors";
import { requestJson } from "../src/api";

describe("requestJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
