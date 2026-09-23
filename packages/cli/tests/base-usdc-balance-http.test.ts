import { brotliCompressSync, gzipSync } from "node:zlib";
import { Dispatcher, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { describe, expect, it, vi } from "vitest";
import { getBaseUsdcBalance } from "../src/base-usdc-balance";

vi.unmock("undici");

describe("Base USDC balance HTTP transport", () => {
  it("decodes compressed HTTP/2 responses through the installed fetch and dispatcher", async () => {
    const requestedPaths: string[] = [];
    class RpcDispatcher extends Dispatcher {
      dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler) {
        requestedPaths.push(options.path);
        const encoding = options.path === "/gzip" ? "gzip" : "br";
        const headers = { "content-type": "application/json", "content-encoding": encoding };
        const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x2710" });
        const controller: Dispatcher.DispatchController = {
          // HTTP/2 supplies a header object; native fetch's legacy bridge loses it.
          rawHeaders: headers,
          aborted: false, paused: false, reason: null,
          resume() {}, pause() {},
          abort(error) { handler.onResponseError?.(this, error); }
        };
        queueMicrotask(() => {
          handler.onRequestStart?.(controller, {});
          handler.onResponseStart?.(controller, 200, headers, "");
          handler.onResponseData?.(controller, encoding === "gzip" ? gzipSync(body) : brotliCompressSync(body));
          handler.onResponseEnd?.(controller, {});
        });
        return true;
      }
    }

    const previous = getGlobalDispatcher();
    setGlobalDispatcher(new RpcDispatcher());
    try {
      await expect(getBaseUsdcBalance("0xa44fc9a56179c734b27cae607c4c5ef4e41468d4", {
        rpcUrls: ["https://rpc-a.example/gzip", "https://rpc-b.example/br"]
      })).resolves.toEqual({ microUsdc: "10000", usdc: "0.010000" });
      expect(requestedPaths).toEqual(["/gzip", "/br"]);
    } finally {
      setGlobalDispatcher(previous);
    }
  });
});
