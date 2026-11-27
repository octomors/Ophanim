import { describe, expect, it } from "vitest";
import type { AppDto, FolderDto } from "./api/types";
import { getAppsVisibilityToggle, getFoldersVisibilityToggle, moveApp } from "./folderRules";

const apps: AppDto[] = [
  { exe: "a.exe", name: "A", first_seen: 0, color: "red", show: true },
  { exe: "b.exe", name: "B", first_seen: 0, color: "blue", show: false },
  { exe: "c.exe", name: "C", first_seen: 0, color: "green", show: true },
];

const folders: FolderDto[] = [
  { id: 1, name: "Tools", on: false, open: true, items: ["a.exe", "b.exe"], color: "purple" },
];

describe("bulk visibility toggles", () => {
  it("toggles only apps that are not in any folder", () => {
    expect(getAppsVisibilityToggle(apps, folders)).toEqual({ exes: ["c.exe"], show: false });
    expect(getAppsVisibilityToggle(apps, [])).toEqual({ exes: ["a.exe", "b.exe", "c.exe"], show: true });
  });

  it("toggles every folder based only on whether all folders are active", () => {
    expect(getFoldersVisibilityToggle(folders).map((folder) => folder.on)).toEqual([true]);
    const activeFolders = [
      ...folders.map((folder) => ({ ...folder, on: true })),
      { id: 2, name: "Other", on: true, open: false, items: ["c.exe"], color: "gold" },
    ];
    expect(getFoldersVisibilityToggle(activeFolders)
      .map((folder) => folder.on)).toEqual([false, false]);
  });
});

describe("moveApp", () => {
  it("creates folders, moves apps between folders, and removes empty folders", () => {
    const created = moveApp([], "a.exe", { app: "b.exe" });
    expect(created?.folders[0]).toMatchObject({
      id: 1,
      items: ["b.exe", "a.exe"],
      on: true,
      open: true,
    });

    const added = moveApp(created!.folders, "c.exe", { folder: 1 });
    expect(added?.folders[0].items).toEqual(["b.exe", "a.exe", "c.exe"]);

    const removed = moveApp(added!.folders, "a.exe", null);
    expect(removed?.folders[0].items).toEqual(["b.exe", "c.exe"]);

    const moved = moveApp(
      [...removed!.folders, { ...folders[0], id: 2, items: ["d.exe"] }],
      "b.exe",
      { folder: 2 },
    );
    expect(moved?.folders).toHaveLength(2);
    expect(moved?.folders[0].items).toEqual(["c.exe"]);
    expect(moved?.folders[1].items).toEqual(["d.exe", "b.exe"]);

    const emptied = moveApp([{ ...folders[0], items: ["a.exe"] }], "a.exe", null);
    expect(emptied?.folders).toEqual([]);
  });

  it("does nothing when dropping onto itself or a sibling in the same folder", () => {
    expect(moveApp(folders, "a.exe", { app: "a.exe" })).toBeNull();
    expect(moveApp(folders, "a.exe", { app: "b.exe" })).toBeNull();
  });
});
