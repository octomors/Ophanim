export type AppDayAggregate = {
  seconds: number;
  max_focus: number;
  focus_count: number;
  launches: number;
};

export type AppDto = {
  exe: string;
  name: string;
  first_seen: number;
  color: string;
  show: boolean;
};

export type FolderDto = {
  id: number;
  name: string;
  on: boolean;
  open: boolean;
  items: string[];
  color: string;
};

export type FocusSegment = {
  day: string;
  start: number;
  end: number;
  exe: string;
  title: string;
};

export type DaySession = { start: number; end: number };

export type DaySummaryDto = {
  date: string;
  apps: Record<string, AppDayAggregate>;
};

export type DayDetailDto = {
  date: string;
  segments: FocusSegment[];
  sessions: DaySession[];
  off_periods: DaySession[];
  launches: Record<string, number>;
};

export type EntitySegmentsDto = {
  segments: FocusSegment[];
  raw_segments: FocusSegment[];
};

export type ClientStateDto = {
  days: DaySummaryDto[];
  apps: AppDto[];
  folders: FolderDto[];
  bad_lines: number;
  last_event: string | null;
  log_folder: string | null;
  error: string | null;
};

export type OverviewDto = {
  days: DayDetailDto[];
  segments: FocusSegment[];
  sessions: DaySession[];
  off_periods: DaySession[];
  apps: Record<string, AppDto>;
};
