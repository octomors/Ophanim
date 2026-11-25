import { create } from "zustand";
import type {
  ClientStateDto,
  DayDetailDto,
  EntitySegmentsDto,
  OverviewDto,
} from "./api/types";

export type Screen = "overview" | "day" | "app";
export type SortKey = "seconds" | "first" | "max" | "average" | "launches" | "name";
export type ChartView = "heatmap" | "histogram" | "donut";

type UiState = {
  data: ClientStateDto | null;
  overview: OverviewDto | null;
  detail: DayDetailDto | null;
  appSegments: EntitySegmentsDto | null;
  screen: Screen;
  day: string | null;
  entity: string | null;
  span: number;
  view: ChartView;
  sort: SortKey;
  descending: boolean;
  search: string;
  countUnusedDays: boolean;
  loading: boolean;
  error: string | null;
  setData: (data: ClientStateDto) => void;
  setOverview: (overview: OverviewDto) => void;
  setDetail: (detail: DayDetailDto | null) => void;
  setAppSegments: (segments: EntitySegmentsDto | null) => void;
  patch: (values: Partial<UiState>) => void;
};

export const useUi = create<UiState>((set) => ({
  data: null,
  overview: null,
  detail: null,
  appSegments: null,
  screen: "overview",
  day: null,
  entity: null,
  span: 30,
  view: "heatmap",
  sort: "seconds",
  descending: true,
  search: "",
  countUnusedDays: false,
  loading: true,
  error: null,
  setData: (data) => set({ data, loading: false, error: data.error }),
  setOverview: (overview) => set({ overview }),
  setDetail: (detail) => set({ detail }),
  setAppSegments: (appSegments) => set({ appSegments }),
  patch: (values) => set(values),
}));
