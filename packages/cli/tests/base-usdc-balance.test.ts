import { afterEach, describe, expect, it, vi } from "vitest";
import { BASE_RPC_URLS, balanceOfCalldata, getBaseUsdcBalance } from "../src/base-usdc-balance";

const ADDRESS = "0xa44fc9a56179c734b27cae607c4c5ef4e41468d4";

function rpcResponse(result: string) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("Base USDC balance RPC", () => {
  afterEach(() => vi.useRealTimers());

  it("encodes ERC-20 balanceOf calldata without an ABI dependency", () => {
    expect(balanceOfCalldata(ADDRESS.toUpperCase())).toBe(`0x70a08231000000000000000000000000${ADDRESS.slice(2)}`);
  });

  it("returns a formatted balance after two matching RPC responses", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url === "https://rpc-a.example") return rpcResponse("0x0e95fc");
      if (url === "https://rpc-b.example") return rpcResponse("0x0e95fc");
      if (url === "https://rpc-c.example") return rpcResponse("0x0e95fd");
      return new Response(JSON.stringify({ error: { code: -32000, message: "upstream unavailable" } }), { status: 200 });
    });

    await expect(
      getBaseUsdcBalance(ADDRESS, {
        rpcUrls: ["https://rpc-a.example", "https://rpc-b.example", "https://rpc-c.example", "https://rpc-d.example"],
        fetchFn
      })
    ).resolves.toEqual({ microUsdc: "955900", usdc: "0.955900" });

    expect(fetchFn).toHaveBeenCalledTimes(4);
    const body = JSON.parse(String(fetchFn.mock.calls[0][1].body)) as { method: string; params: [{ to: string; data: string }, string] };
    expect(body.method).toBe("eth_call");
    expect(body.params).toEqual([
      {
        to: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        data: `0x70a08231000000000000000000000000${ADDRESS.slice(2)}`
      },
      "latest"
    ]);
  });

  it("fails when fewer than two RPC responses agree", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url === "https://rpc-a.example") return rpcResponse("0x01");
      if (url === "https://rpc-b.example") return rpcResponse("0x02");
      return new Response("gateway timeout", { status: 504, statusText: "Gateway Timeout" });
    });

    await expect(
      getBaseUsdcBalance(ADDRESS, {
        rpcUrls: ["https://rpc-a.example", "https://rpc-b.example", "https://rpc-c.example", "https://rpc-d.example"],
        fetchFn
      })
    ).rejects.toThrow(
      "rpc-a.example: 1 microUSDC; rpc-b.example: 2 microUSDC; rpc-c.example: HTTP 504 Gateway Timeout; rpc-d.example: HTTP 504 Gateway Timeout"
    );
  });

  it("reports the endpoint and underlying fetch cause without exposing URL credentials", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("connection failed"), { code: "ECONNRESET" }) });
    });
    const error = await getBaseUsdcBalance(ADDRESS, {
      rpcUrls: ["https://user:password@rpc-a.example/private-key?token=secret", "https://rpc-b.example"],
      fetchFn
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("rpc-a.example: ECONNRESET; rpc-b.example: ECONNRESET");
    expect((error as Error).message).not.toMatch(/password|private-key|secret/);
  });

  it("distinguishes HTTP failures from invalid JSON and RPC errors", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith("rpc-a.example")) return new Response("private gateway response", { status: 429 });
      if (url.endsWith("rpc-b.example")) return new Response("not JSON");
      if (url.endsWith("rpc-c.example")) return rpcResponse("invalid");
      return new Response(JSON.stringify({ error: { code: -32000, message: "upstream unavailable" } }));
    });
    const error = await getBaseUsdcBalance(ADDRESS, {
      rpcUrls: ["https://rpc-a.example", "https://rpc-b.example", "https://rpc-c.example", "https://rpc-d.example"],
      fetchFn
    }).catch((cause: unknown) => cause);

    expect((error as Error).message).toContain("rpc-a.example: HTTP 429; rpc-b.example: RPC returned non-JSON response; rpc-c.example: RPC returned an invalid balance result; rpc-d.example: RPC error: -32000: upstream unavailable");
    expect((error as Error).message).not.toContain("private gateway response");
  });

  it("removes request URLs echoed by native fetch errors", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      throw new TypeError("fetch failed", { cause: new TypeError(`Request cannot be constructed from a URL that includes credentials: ${url}`) });
    });
    const error = await getBaseUsdcBalance(ADDRESS, {
      rpcUrls: ["https://user:password@rpc-a.example/private-key?token=secret", "https://user:password@rpc-b.example"], fetchFn
    }).catch((cause: unknown) => cause);

    expect((error as Error).message).toContain("rpc-a.example: Request cannot be constructed from a URL that includes credentials: rpc-a.example");
    expect((error as Error).message).not.toMatch(/password|private-key|secret/);
  });

  it("rejects invalid endpoint URLs before starting requests or timers", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn();
    await expect(getBaseUsdcBalance(ADDRESS, {
      rpcUrls: ["not-a-url", "https://rpc-b.example"], fetchFn
    })).rejects.toThrow("Invalid URL");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds provider error messages in quorum diagnostics", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ error: { message: "x".repeat(10000) } })));
    const error = await getBaseUsdcBalance(ADDRESS, {
      rpcUrls: ["https://rpc-a.example", "https://rpc-b.example"], fetchFn
    }).catch((cause: unknown) => cause);

    expect((error as Error).message).toContain("rpc-a.example: RPC error:");
    expect((error as Error).message.length).toBeLessThan(1000);
  });

  it("reports timed-out endpoints without extending the requested deadline", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    }));
    const result = getBaseUsdcBalance(ADDRESS, {
      rpcUrls: ["https://rpc-a.example", "https://rpc-b.example"], fetchFn, timeoutMs: 100
    }).catch((cause: unknown) => cause);
    await vi.advanceTimersByTimeAsync(100);
    expect((await result as Error).message).toContain("rpc-a.example: timed out after 100ms; rpc-b.example: timed out after 100ms");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses at least two HTTPS endpoints for the public Base RPC quorum", () => {
    expect(BASE_RPC_URLS.length).toBeGreaterThanOrEqual(2);
    expect(BASE_RPC_URLS.every((url) => new URL(url).protocol === "https:")).toBe(true);
    expect(new Set(BASE_RPC_URLS).size).toBe(BASE_RPC_URLS.length);
  });
});
