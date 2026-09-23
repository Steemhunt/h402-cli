import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliConfig } from "../src/config";
import type { ParsedArgs } from "../src/utils";
import { ADDR, owsMockFactory, printed } from "./helpers";

const { loadConfig, getBaseUsdcBalance } = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  getBaseUsdcBalance: vi.fn()
}));

vi.mock("../src/config.js", async (original) => ({ ...await original<typeof import("../src/config")>(), loadConfig }));
vi.mock("../src/ows.js", () => owsMockFactory());
vi.mock("../src/base-usdc-balance.js", async (original) => ({
  ...await original<typeof import("../src/base-usdc-balance")>(),
  getBaseUsdcBalance
}));

const { walletCommand } = await import("../src/commands");
const FUNDING_URL = `https://h402.hunt.town/wallet/fund?address=${ADDR}&amount=5`;
const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

function args(flags: ParsedArgs["flags"] = {}): ParsedArgs {
  return { positional: ["wallet", "fund"], flags };
}

function setTty(value: boolean) {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
}

describe("wallet funding", () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubEnv("H402_API_URL", undefined);
    setTty(false);
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    loadConfig.mockResolvedValue({
      backendUrl: "https://h402.hunt.town",
      wallets: { h402: { address: ADDR } },
      sessions: {}
    } satisfies CliConfig);
    getBaseUsdcBalance.mockReset();
    getBaseUsdcBalance.mockResolvedValue({ microUsdc: "10000000", usdc: "10.000000" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    stdout.mockRestore();
    stderr.mockRestore();
    if (stdinTty) Object.defineProperty(process.stdin, "isTTY", stdinTty);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
    if (stdoutTty) Object.defineProperty(process.stdout, "isTTY", stdoutTty);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  });

  it("returns one funding link immediately without RPC calls in noninteractive use", async () => {
    await walletCommand(args());

    expect(printed(stdout)).toEqual({
      wallet: { name: "h402", address: ADDR },
      network: "base",
      token: "USDC",
      suggestedAmount: "5",
      fundingUrl: FUNDING_URL,
      status: "awaiting_funds"
    });
    expect(stdout).toHaveBeenCalledTimes(1);
    expect(stderr).not.toHaveBeenCalled();
    expect(getBaseUsdcBalance).not.toHaveBeenCalled();
  });

  it("uses the explicit backend origin and an exact normalized decimal amount", async () => {
    vi.stubEnv("H402_API_URL", "https://ignored.example");
    await walletCommand(args({ "api-url": "http://localhost:3000/api?ignored=yes#ignored", amount: "0001.234560" }));

    expect(printed(stdout)).toMatchObject({
      suggestedAmount: "1.23456",
      fundingUrl: `http://localhost:3000/wallet/fund?address=${ADDR}&amount=1.23456`
    });
  });

  it("honors the environment and configured backend when no explicit URL is given", async () => {
    vi.stubEnv("H402_API_URL", "https://env.example");
    await walletCommand(args());
    expect(printed(stdout).fundingUrl).toBe(`https://env.example/wallet/fund?address=${ADDR}&amount=5`);

    stdout.mockClear();
    vi.stubEnv("H402_API_URL", undefined);
    loadConfig.mockResolvedValueOnce({ backendUrl: "https://configured.example", wallets: { h402: { address: ADDR } }, sessions: {} });
    await walletCommand(args());
    expect(printed(stdout).fundingUrl).toBe(`https://configured.example/wallet/fund?address=${ADDR}&amount=5`);
  });

  it.each(["0", "-1", "1.0000001", "1e3", "Infinity", ".5"])("rejects invalid suggested amount %s", async (amount) => {
    await expect(walletCommand(args({ amount }))).rejects.toThrow(/--amount/);
    expect(getBaseUsdcBalance).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
  });

  it("accepts the uint256 maximum and rejects one micro-USDC above it", async () => {
    const maximum = "115792089237316195423570985008687907853269984665640564039457584007913129.639935";
    await walletCommand(args({ amount: maximum }));
    expect(printed(stdout).suggestedAmount).toBe(maximum);

    stdout.mockClear();
    await expect(walletCommand(args({ amount: "115792089237316195423570985008687907853269984665640564039457584007913129.639936" })))
      .rejects.toThrow(/exceeds the maximum USDC transfer amount/);
    expect(stdout).not.toHaveBeenCalled();
    expect(getBaseUsdcBalance).not.toHaveBeenCalled();
  });

  it.each(["0", "-1", "1.5", "3601", "Infinity", "1e3"])("rejects invalid timeout %s", async (timeout) => {
    await expect(walletCommand(args({ timeout }))).rejects.toThrow(/--timeout/);
    expect(getBaseUsdcBalance).not.toHaveBeenCalled();
  });

  it.each(["/relative", "javascript:alert(1)", "file:///tmp/fund", "https://user:password@example.com"])("rejects unsafe backend URL %s", async (url) => {
    await expect(walletCommand(args({ "api-url": url }))).rejects.toThrow(/funding backend URL/);
    expect(stdout).not.toHaveBeenCalled();
  });

  it("waits for a strict increase and reports the actual delta below the suggested amount", async () => {
    getBaseUsdcBalance
      .mockResolvedValueOnce({ microUsdc: "10000000", usdc: "10.000000" })
      .mockResolvedValueOnce({ microUsdc: "10000000", usdc: "10.000000" })
      .mockResolvedValueOnce({ microUsdc: "10250000", usdc: "10.250000" });
    const task = walletCommand(args({ wait: true }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(stdout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    await task;

    expect(printed(stdout)).toMatchObject({
      status: "funded",
      suggestedAmount: "5",
      balance: { microUsdc: "10250000", usdc: "10.250000" },
      received: { microUsdc: "250000", usdc: "0.25" }
    });
    expect(stdout).toHaveBeenCalledTimes(1);
    expect(stderr).not.toHaveBeenCalled();
  });

  it("shares the link on stderr and waits by default on an interactive terminal", async () => {
    setTty(true);
    getBaseUsdcBalance.mockResolvedValueOnce({ microUsdc: "0", usdc: "0.000000" });
    const task = walletCommand(args());
    await vi.advanceTimersByTimeAsync(0);
    expect(stderr.mock.calls.map(([text]) => text).join("")).toContain(FUNDING_URL);
    expect(stdout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    await task;
    expect(printed(stdout).status).toBe("funded");
    expect(stdout).toHaveBeenCalledTimes(1);
  });

  it("times out without mistaking an existing or decreased balance for new funds", async () => {
    getBaseUsdcBalance.mockResolvedValueOnce({ microUsdc: "11000000", usdc: "11.000000" });
    const task = expect(walletCommand(args({ wait: true, timeout: "21" }))).rejects.toMatchObject({
      message: expect.stringContaining("A transfer may still arrive"),
      detail: { reason: "timeout", fundingUrl: FUNDING_URL, balance: { microUsdc: "10000000", usdc: "10.000000" } }
    });
    await vi.advanceTimersByTimeAsync(21_000);
    await task;
    expect(stdout).not.toHaveBeenCalled();
    expect(getBaseUsdcBalance).toHaveBeenCalledTimes(3);
    expect(getBaseUsdcBalance).toHaveBeenLastCalledWith(ADDR, { timeoutMs: 1000 });
  });

  it("still polls when the timeout is shorter than the usual polling interval", async () => {
    getBaseUsdcBalance.mockResolvedValueOnce({ microUsdc: "0", usdc: "0.000000" });
    const task = walletCommand(args({ wait: true, timeout: "1" }));
    await vi.advanceTimersByTimeAsync(500);
    await task;
    expect(printed(stdout).status).toBe("funded");
    expect(getBaseUsdcBalance).toHaveBeenLastCalledWith(ADDR, { timeoutMs: 500 });
  });

  it.each([
    { timeout: "5", baselineMs: 3000 },
    { timeout: "1", baselineMs: 600 }
  ])("detects funds within a $timeout-second wait after a slow baseline", async ({ timeout, baselineMs }) => {
    getBaseUsdcBalance.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, baselineMs));
      return { microUsdc: "0", usdc: "0.000000" };
    });
    const task = walletCommand(args({ wait: true, timeout })).then(() => null, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(Number(timeout) * 1000);

    expect(await task).toBeNull();
    expect(getBaseUsdcBalance).toHaveBeenCalledTimes(2);
    expect(getBaseUsdcBalance).toHaveBeenLastCalledWith(ADDR, { timeoutMs: (Number(timeout) * 1000 - baselineMs) / 2 });
    expect(printed(stdout)).toMatchObject({ status: "funded", received: { microUsdc: "10000000", usdc: "10" } });
    expect(stdout).toHaveBeenCalledTimes(1);
  });

  it("keeps the original deadline and a fixed cadence after a slow baseline", async () => {
    getBaseUsdcBalance.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return { microUsdc: "10000000", usdc: "10.000000" };
    });
    const settled = vi.fn();
    const task = walletCommand(args({ wait: true, timeout: "5" })).then(settled, settled);
    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).not.toHaveBeenCalled();
    expect(getBaseUsdcBalance).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await task;

    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ reason: "timeout", fundingUrl: FUNDING_URL }) }));
    expect(getBaseUsdcBalance).toHaveBeenCalledTimes(2);
    expect(stdout).not.toHaveBeenCalled();
  });

  it("reports baseline RPC failure with the funding link and no false success", async () => {
    getBaseUsdcBalance.mockRejectedValue(new Error("RPC quorum failed"));
    await expect(walletCommand(args({ wait: true }))).rejects.toMatchObject({
      detail: { reason: "balance_unavailable", fundingUrl: FUNDING_URL, cause: "RPC quorum failed" }
    });
    expect(stdout).not.toHaveBeenCalled();
  });

  it("retries a transient polling RPC error within the deadline", async () => {
    getBaseUsdcBalance
      .mockResolvedValueOnce({ microUsdc: "0", usdc: "0.000000" })
      .mockRejectedValueOnce(new Error("RPC quorum failed"));
    const task = walletCommand(args({ wait: true, timeout: "30" }));
    await vi.advanceTimersByTimeAsync(20_000);
    await task;
    expect(printed(stdout).status).toBe("funded");
  });

  it("distinguishes unavailable RPC readings from an observed unchanged balance at timeout", async () => {
    getBaseUsdcBalance.mockResolvedValueOnce({ microUsdc: "0", usdc: "0.000000" }).mockRejectedValue(new Error("RPC quorum failed"));
    const task = expect(walletCommand(args({ wait: true, timeout: "21" }))).rejects.toMatchObject({
      detail: { reason: "balance_unavailable", fundingUrl: FUNDING_URL, cause: "RPC quorum failed" }
    });
    await vi.advanceTimersByTimeAsync(21_000);
    await task;
    expect(stdout).not.toHaveBeenCalled();
  });
});
