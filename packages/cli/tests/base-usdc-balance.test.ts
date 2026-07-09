import { describe, expect, it, vi } from "vitest";
import { BASE_RPC_URLS, balanceOfCalldata, getBaseUsdcBalance } from "../src/base-usdc-balance";

const ADDRESS = "0xa44fc9a56179c734b27cae607c4c5ef4e41468d4";

function rpcResponse(result: string) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("Base USDC balance RPC", () => {
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
    ).rejects.toThrow(/temporarily unavailable/);
  });

  it("uses the requested public Base RPC quorum", () => {
    expect(BASE_RPC_URLS).toEqual(["https://base-rpc.publicnode.com", "https://base.drpc.org", "https://mainnet.base.org", "https://1rpc.io/base"]);
  });
});
