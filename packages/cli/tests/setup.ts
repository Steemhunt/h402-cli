import { vi } from "vitest";

// Keep existing per-test fetch stubs at the transport boundary. The HTTP
// integration test unmocks Undici to exercise the real dispatcher and fetch.
vi.mock("undici", async (importOriginal) => ({
  ...await importOriginal<typeof import("undici")>(),
  fetch: (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args)
}));
