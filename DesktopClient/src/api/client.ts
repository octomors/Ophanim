import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  ClientStateDto,
  EntitySegmentsDto,
  FolderDto,
  OverviewDto,
} from "./types";

export const getState = () => invoke<ClientStateDto>("get_state");
export const getOverview = (span: number) =>
  invoke<OverviewDto>("get_overview", { span });
export const getDayData = (date: string) =>
  invoke<import("./types").DayDetailDto | null>("get_day_data", { date });
export const getAppSegments = (entity: string, start: string, end: string) =>
  invoke<EntitySegmentsDto>("get_app_segments", { entity, start, end });
export const loadFolder = (path: string) =>
  invoke<ClientStateDto>("load_folder", { path });
export const loadFiles = (files: Array<[string, string]>) =>
  invoke<ClientStateDto>("load_files", { files });
export const loadFilePaths = (paths: string[]) =>
  invoke<ClientStateDto>("load_file_paths", { paths });
export const loadDemo = () => invoke<ClientStateDto>("load_bundled_demo");
export const setAppVisibility = (exe: string, show: boolean) =>
  invoke<void>("set_app_visibility", { exe, show });
export const saveFolders = (folders: FolderDto[], nextId: number) =>
  invoke<ClientStateDto>("save_folders", {
    folders: folders.map(({ id, name, on, open, items }) => ({
      id,
      name,
      on,
      open,
      items,
    })),
    nextId,
  });

export async function chooseLogFolder(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false, title: "Choose DayLogs folder" });
  return typeof result === "string" ? result : null;
}

export async function chooseLogFiles(): Promise<string[] | null> {
  const result = await open({
    multiple: true,
    title: "Choose NDJSON log files",
    filters: [{ name: "Day logs", extensions: ["ndjson", "jsonl", "json", "txt", "log"] }],
  });
  return Array.isArray(result) ? result : result ? [result] : null;
}
