import { create } from "zustand";
import type {
  ClientStateDto,
  DayDetailDto,
} from "./api/types";

export type Screen = "overview" | "day" | "app";
export type SortKey = "seconds" | "first" | "max" | "average" | "launches" | "name";
export type ChartView = "heatmap" | "histogram" | "donut";

type UiState = {
  data: ClientStateDto | null;
  detail: DayDetailDto | null;
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
  setDetail: (detail: DayDetailDto | null) => void;
  patch: (values: Partial<UiState>) => void;
};

export const useUi = create<UiState>((set) => ({
  data: null,
  detail: null,
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
  setDetail: (detail) => set({ detail }),
  patch: (values) => set(values),
}));
