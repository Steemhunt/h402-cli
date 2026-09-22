import { once } from "node:events";
import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { requestJson } from "../src/api";

vi.unmock("undici");

describe("HTTP transport", () => {
  it("sends JSON through the installed Undici fetch and dispatcher", async () => {
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        method: request.method,
        authorization: request.headers.authorization,
        userAgent: request.headers["user-agent"],
        body: JSON.parse(body)
      }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP address");

    try {
      const result = await requestJson(`http://127.0.0.1:${address.port}`, "/request", {
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
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
