import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  ClientStateDto,
  EntitySegmentsDto,
  FolderDto,
  OverviewDto,
} from "./types";

const stateRequests = new Map<string, Promise<ClientStateDto>>();
const overviewRequests = new Map<string, Promise<OverviewDto>>();
const dayRequests = new Map<string, Promise<import("./types").DayDetailDto | null>>();
const appSegmentRequests = new Map<string, Promise<EntitySegmentsDto>>();

function invokeOnce<T>(
  pending: Map<string, Promise<T>>,
  key: string,
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing;
  const request = invoke<T>(command, args);
  pending.set(key, request);
  const clear = () => {
    if (pending.get(key) === request) pending.delete(key);
  };
  void request.then(clear, clear);
  return request;
}

export const getState = () => invokeOnce(stateRequests, "state", "get_state");
export const getOverview = (span: number, revision = 0, folderSignature = "") =>
  invokeOnce(
    overviewRequests,
    JSON.stringify([span, revision, folderSignature]),
    "get_overview",
    { span },
  );
export const getDayData = (date: string, revision = 0, folderSignature = "") =>
  invokeOnce(
    dayRequests,
    JSON.stringify([date, revision, folderSignature]),
    "get_day_data",
    { date },
  );
export const getAppSegments = (entity: string, start: string, end: string, revision = 0) =>
  invokeOnce(
    appSegmentRequests,
    JSON.stringify([entity, start, end, revision]),
    "get_app_segments",
    { entity, start, end },
  );
export const loadFolder = (path: string) =>
  invoke<ClientStateDto>("load_folder", { path });
export const loadFiles = (files: Array<[string, string]>) =>
  invoke<ClientStateDto>("load_files", { files });
export const loadFilePaths = (paths: string[]) =>
  invoke<ClientStateDto>("load_file_paths", { paths });
export const loadDemo = () => invoke<ClientStateDto>("load_bundled_demo");
export const setAppVisibility = (exe: string, show: boolean) =>
  invoke<void>("set_app_visibility", { exe, show });
export const setAppsVisibility = (exes: string[], show: boolean) =>
  invoke<void>("set_apps_visibility", { exes, show });
export const saveFolders = (folders: FolderDto[], nextId: number) =>
  invoke<void>("save_folders", {
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
