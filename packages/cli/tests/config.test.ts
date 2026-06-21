import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backendUrl, type CliConfig } from "../src/config";

const PROD_URL = "https://h402.hunt.town";

function configWith(backend?: string): CliConfig {
  return { backendUrl: backend as string, sessions: {}, wallets: {} };
}

describe("backendUrl resolution", () => {
  const savedEnv = process.env.H402_API_URL;

  beforeEach(() => {
    delete process.env.H402_API_URL;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.H402_API_URL;
    } else {
      process.env.H402_API_URL = savedEnv;
    }
  });

  it("defaults to the production backend when no flag, env, or saved config is set", () => {
    expect(backendUrl(configWith(undefined))).toBe(PROD_URL);
  });

  it("prefers a saved config URL over the default", () => {
    expect(backendUrl(configWith("https://staging.example"))).toBe("https://staging.example");
  });

  it("prefers H402_API_URL over the saved config", () => {
    process.env.H402_API_URL = "https://env.example";
    expect(backendUrl(configWith("https://staging.example"))).toBe("https://env.example");
  });

  it("prefers the --api-url flag over env and saved config", () => {
    process.env.H402_API_URL = "https://env.example";
    expect(backendUrl(configWith("https://staging.example"), "http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("strips a trailing slash from the resolved URL", () => {
    expect(backendUrl(configWith(undefined), "https://h402.hunt.town/")).toBe(PROD_URL);
  });
});
