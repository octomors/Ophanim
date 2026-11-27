import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { getAppSegments } from "./client";

describe("Tauri request deduplication", () => {
  beforeEach(() => invokeMock.mockReset());

  it("shares an in-flight app-segment request with the same query", async () => {
    invokeMock.mockResolvedValue({ segments: [], raw_segments: [] });

    const first = getAppSegments("code.exe", "2026-09-01", "2026-09-30");
    const second = getAppSegments("code.exe", "2026-09-01", "2026-09-30");

    expect(second).toBe(first);
    expect(invokeMock).toHaveBeenCalledOnce();
    await Promise.all([first, second]);
  });

  it("does not share requests for different date ranges", async () => {
    invokeMock.mockResolvedValue({ segments: [], raw_segments: [] });

    const first = getAppSegments("code.exe", "2026-09-01", "2026-09-07");
    const second = getAppSegments("code.exe", "2026-09-08", "2026-09-14");

    expect(invokeMock).toHaveBeenCalledTimes(2);
    await Promise.all([first, second]);
  });
});
