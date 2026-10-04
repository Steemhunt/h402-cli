import { once } from "node:events";
import { createServer, type RequestListener } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { assertOk, requestJson } from "../src/api";

vi.unmock("undici");

async function withServer(handler: RequestListener, run: (url: string) => Promise<void>) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe("HTTP transport", () => {
  it("sends JSON through the installed Undici fetch and dispatcher", async () => {
    await withServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        method: request.method,
        authorization: request.headers.authorization,
        userAgent: request.headers["user-agent"],
        body: JSON.parse(body)
      }));
    }, async (url) => {
      const result = await requestJson(url, "/request", {
        method: "POST",
        token: "test-token",
        body: JSON.stringify({ query: "web search" })
      });
      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        method: "POST",
        authorization: "Bearer test-token",
        userAgent: expect.stringMatching(/^h402-cli\/\d+\.\d+\.\d+/),
        body: { query: "web search" }
      });
    });
  });

  it.each([302, 307])("does not forward a signed POST across a %i redirect", async (status) => {
    const target = vi.fn((_request, response) => response.end('{"ok":true}'));
    await withServer(target, async (destination) => {
      await withServer((_request, response) => {
        response.writeHead(status, { location: `${destination}/routes/other/web/search` });
        response.end();
      }, async (url) => {
        const result = await requestJson(url, "/routes/pinned/web/search", {
          method: "POST",
          headers: { "PAYMENT-SIGNATURE": "test-authorization", "idempotency-key": "test-key" },
          body: '{"query":"web search"}'
        });
        expect(result.status).toBe(status);
        expect(() => assertOk(result)).toThrow(`Request failed: ${status}`);
        expect(target).not.toHaveBeenCalled();
      });
    });
  });

  it("does not change a pinned provider through a same-origin redirect", async () => {
    const redirected = vi.fn();
    await withServer((request, response) => {
      if (request.url === "/routes/pinned/web/search") {
        response.writeHead(307, { location: "/routes/other/web/search" });
      } else {
        redirected();
      }
      response.end();
    }, async (url) => {
      const result = await requestJson(url, "/routes/pinned/web/search");
      expect(result.status).toBe(307);
      expect(redirected).not.toHaveBeenCalled();
    });
  });

  it("preserves backend context when the response body is interrupted", async () => {
    await withServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json", "content-length": "100" });
      response.write('{"data":');
      setTimeout(() => response.destroy(), 25);
    }, async (url) => {
      await expect(requestJson(url, "/routes/pinned/web/search")).rejects.toMatchObject({
        name: "CliError",
        message: `Request to ${url}/routes/pinned/web/search failed: UND_ERR_SOCKET`,
        detail: { backendUrl: url, url: `${url}/routes/pinned/web/search` }
      });
    });
  });
});
