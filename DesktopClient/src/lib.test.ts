import { describe, expect, it } from "vitest";
import type { ClientStateDto, FocusSegment } from "./api/types";
import { segmentClusters, visibleDailyAggregates, visibleSegments } from "./lib";

describe("segmentClusters", () => {
  it("joins short focus intervals only while the whole block stays under 30 minutes", () => {
    const segments: FocusSegment[] = [
      { day: "2026-09-11", start: 0, end: 1000, exe: "a.exe", title: "" },
      { day: "2026-09-11", start: 1100, end: 1800, exe: "b.exe", title: "" },
      { day: "2026-09-11", start: 1900, end: 2000, exe: "a.exe", title: "" },
      { day: "2026-09-11", start: 2100, end: 2200, exe: "b.exe", title: "" },
    ];
    const result = segmentClusters(segments);
    expect(result).toHaveLength(2);
    expect(result[0].segments).toHaveLength(2);
    expect(result[0].end - result[0].start).toBe(1800);
    expect(result[1].segments).toHaveLength(2);
  });

  it("keeps long focus intervals separate and never merges across days", () => {
    const segments: FocusSegment[] = [
      { day: "2026-09-11", start: 0, end: 1800, exe: "a.exe", title: "" },
      { day: "2026-09-12", start: 0, end: 20, exe: "a.exe", title: "" },
    ];
    expect(segmentClusters(segments)).toHaveLength(2);
  });
});

describe("visibleSegments", () => {
  it("uses prepared folder segments and respects app visibility while the folder is off", () => {
    const data: ClientStateDto = {
      days: [],
      apps: [
        { exe: "a.exe", name: "A", first_seen: 0, color: "red", show: false },
        { exe: "b.exe", name: "B", first_seen: 0, color: "blue", show: true },
      ],
      folders: [{ id: 1, name: "Tools", on: true, open: true, items: ["a.exe", "b.exe"], color: "green" }],
      bad_lines: 0,
      last_event: null,
      log_folder: null,
      error: null,
    };
    const input: FocusSegment[] = [
      { day: "2026-09-11", start: 10, end: 20, exe: "a.exe", title: "A" },
      { day: "2026-09-11", start: 20, end: 40, exe: "b.exe", title: "B" },
      { day: "2026-09-11", start: 10, end: 40, exe: "f:1", title: "A" },
    ];
    expect(visibleSegments(data, input)).toMatchObject([
      { day: "2026-09-11", start: 10, end: 40, exe: "f:1" },
    ]);

    data.folders[0].on = false;
    expect(visibleSegments(data, input)).toEqual([input[1]]);
  });
});

describe("visibleDailyAggregates", () => {
  it("uses enabled folder totals, excludes its members, and limits dates", () => {
    const data: ClientStateDto = {
      days: [
        {
          date: "2026-09-11",
          apps: {
            "a.exe": { seconds: 30, max_focus: 20, focus_count: 2, launches: 1 },
            "b.exe": { seconds: 40, max_focus: 40, focus_count: 1, launches: 0 },
            "f:1": { seconds: 70, max_focus: 60, focus_count: 1, launches: 1 },
            "c.exe": { seconds: 90, max_focus: 90, focus_count: 1, launches: 1 },
          },
        },
        {
          date: "2026-09-12",
          apps: {
            "c.exe": { seconds: 10, max_focus: 10, focus_count: 1, launches: 0 },
          },
        },
      ],
      apps: [
        { exe: "a.exe", name: "A", first_seen: 0, color: "red", show: false },
        { exe: "b.exe", name: "B", first_seen: 0, color: "blue", show: true },
        { exe: "c.exe", name: "C", first_seen: 0, color: "gray", show: true },
      ],
      folders: [{ id: 1, name: "Tools", on: true, open: true, items: ["a.exe", "b.exe"], color: "green" }],
      bad_lines: 0,
      last_event: null,
      log_folder: null,
      error: null,
    };

    const result = visibleDailyAggregates(data, ["2026-09-11"]);
    expect([...result.get("2026-09-11")!.keys()].sort()).toEqual(["c.exe", "f:1"]);
    expect(result.get("2026-09-11")!.get("f:1")?.seconds).toBe(70);
    expect(result.get("2026-09-11")!.get("f:1")?.focus_count).toBe(1);
    expect(result.has("2026-09-12")).toBe(false);
  });
});
