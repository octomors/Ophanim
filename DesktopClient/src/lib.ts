import type {
  AppDayAggregate,
  AppDto,
  ClientStateDto,
  FocusSegment,
  FolderDto,
} from "./api/types";
import type { SortKey } from "./state";

export const daySeconds = 86_400;
export const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (value: number) => String(value).padStart(2, "0");

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours ? `${hours}h ${pad(minutes)}m` : minutes ? `${minutes}m` : `${total}s`;
}

export function formatDate(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(2, 4)}`;
}

export function formatAxisDate(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`;
}

export function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function formatClock(seconds: number): string {
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}`;
}

export type AppStats = {
  key: string;
  name: string;
  color: string;
  first: number;
  seconds: number;
  max: number;
  average: number;
  launches: number;
  perDay: Map<string, number>;
  folder?: FolderDto;
};

export type VisibleDailyAggregates = Map<string, Map<string, AppDayAggregate>>;

export function dateRange(data: ClientStateDto, span: number, day?: string | null): string[] {
  if (day) return [day];
  if (!data.days.length) return [];
  const end = data.days[data.days.length - 1].date;
  const start = span === 0
    ? data.days[0].date
    : addDays(end, -(span - 1));
  const result: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) result.push(cursor);
  return result;
}

function sumAppDays(
  days: ClientStateDto["days"],
  apps: AppDto[],
  folders: FolderDto[],
  dates: string[],
): Map<string, AppStats> {
  const appByKey = new Map(apps.map((app) => [app.exe, app]));
  const dailyByDate = new Map(days.map((day) => [day.date, day.apps]));
  const result = new Map<string, AppStats>();
  const put = (key: string, name: string, color: string, first: number, folder?: FolderDto) => {
    const perDay = new Map<string, number>();
    let seconds = 0;
    let max = 0;
    let launches = 0;
    for (const date of dates) {
      const daily = dailyByDate.get(date);
      const aggregate: AppDayAggregate | undefined = folder
        ? daily?.[`f:${folder.id}`]
        : daily?.[key];
      const value = aggregate?.seconds ?? 0;
      if (value > 0) perDay.set(date, value);
      seconds += value;
      max = Math.max(max, value);
      launches += aggregate?.launches ?? 0;
    }
    result.set(key, {
      key,
      name,
      color,
      first,
      seconds,
      max,
      average: seconds / (perDay.size || 1),
      launches,
      perDay,
      folder,
    });
  };
  for (const app of apps) put(app.exe, app.name, app.color, app.first_seen);
  for (const folder of folders) {
    const first = Math.min(...folder.items.map((item) => appByKey.get(item)?.first_seen ?? Number.MAX_SAFE_INTEGER));
    put(`f:${folder.id}`, folder.name, folder.color, Number.isFinite(first) ? first : 0, folder);
  }
  return result;
}

export function getStats(
  data: ClientStateDto,
  span: number,
  day?: string | null,
): Map<string, AppStats> {
  return sumAppDays(data.days, data.apps, data.folders, dateRange(data, span, day));
}

export function sortValue(stats: AppStats, sort: SortKey): number | string {
  switch (sort) {
    case "first": return stats.first;
    case "max": return stats.max;
    case "average": return stats.average;
    case "launches": return stats.launches;
    case "name": return stats.name.toLowerCase();
    default: return stats.seconds;
  }
}

export function visibleEntities(data: ClientStateDto): Map<string, AppDto | FolderDto> {
  const entities = new Map<string, AppDto | FolderDto>();
  for (const folder of data.folders) {
    if (folder.on) entities.set(`f:${folder.id}`, folder);
  }
  for (const app of data.apps) {
    const folder = data.folders.find((item) => item.items.includes(app.exe) && item.on);
    if (!folder && app.show) entities.set(app.exe, app);
  }
  return entities;
}

export function visibleSegments(data: ClientStateDto, segments: FocusSegment[]): FocusSegment[] {
  const active = visibleEntities(data);
  return segments.filter((segment) => active.has(segment.exe));
}

export function visibleDailyAggregates(
  data: ClientStateDto,
  dates: string[],
): VisibleDailyAggregates {
  const active = visibleEntities(data);
  const selectedDates = new Set(dates);
  const result: VisibleDailyAggregates = new Map();
  for (const day of data.days) {
    if (!selectedDates.has(day.date)) continue;
    const entities = new Map<string, AppDayAggregate>();
    for (const [key, aggregate] of Object.entries(day.apps)) {
      if (active.has(key)) entities.set(key, aggregate);
    }
    result.set(day.date, entities);
  }
  return result;
}

export function entityInfo(data: ClientStateDto, key: string): AppDto | FolderDto | undefined {
  if (key.startsWith("f:")) {
    const id = Number(key.slice(2));
    return data.folders.find((folder) => folder.id === id);
  }
  return data.apps.find((app) => app.exe === key);
}

export function segmentClusters(segments: FocusSegment[]): Array<{
  day: string;
  start: number;
  end: number;
  segments: FocusSegment[];
}> {
  const result: Array<{ day: string; start: number; end: number; segments: FocusSegment[] }> = [];
  let current: (typeof result)[number] & { short: boolean } | null = null;
  const flush = () => {
    if (current) result.push(current);
    current = null;
  };
  for (const segment of segments) {
    const short = segment.end - segment.start < 1800;
    if (
      short &&
      current?.short &&
      current.day === segment.day &&
      segment.start - current.end <= 120 &&
      current.end - current.start < 1800
    ) {
      current.segments.push(segment);
      current.end = segment.end;
    } else {
      flush();
      current = {
        day: segment.day,
        start: segment.start,
        end: segment.end,
        segments: [segment],
        short,
      };
      if (!short) flush();
    }
  }
  flush();
  return result;
}

export function titleWithoutAppSuffix(title: string): string {
  return title.replace(/\s[-–—]\s[^-–—]*$/, "") || "(no title)";
}
