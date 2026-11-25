import { useMemo } from "react";
import type { ClientStateDto, DayDetailDto, FocusSegment } from "../api/types";
import { formatDuration, formatClock } from "../lib";
import { visibleSegments } from "../lib";
import { useSize } from "./useSize";

type Props = {
  data: ClientStateDto;
  detail: DayDetailDto;
  zoom: number;
  onZoom: (zoom: number) => void;
  onEntity: (entity: string) => void;
};

const rowHeight = 26;

export function DayTimeline({ data, detail, zoom, onZoom, onEntity }: Props) {
  const { ref, width, height } = useSize<HTMLDivElement>();
  const segments = useMemo(() => visibleSegments(data, detail.segments), [data, detail.segments]);
  const rows = new Map<string, number>();
  segments.forEach((segment) => rows.set(segment.exe, (rows.get(segment.exe) ?? 0) + segment.end - segment.start));
  const entities = [...rows].sort((a, b) => b[1] - a[1]).map(([entity]) => entity);
  const chartWidth = Math.max(400, width - 150) * zoom;
  const chartHeight = entities.length * rowHeight;
  const scroll = (event: React.WheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey) {
      event.preventDefault();
      onZoom(Math.min(12, Math.max(1, zoom * (event.deltaY < 0 ? 1.25 : 0.8))));
    } else {
      event.currentTarget.scrollLeft += event.deltaY + event.deltaX;
      event.preventDefault();
    }
  };
  const totals = new Map<string, number>();
  segments.forEach((segment) => totals.set(segment.exe, (totals.get(segment.exe) ?? 0) + segment.end - segment.start));
  const hours = Array.from({ length: 25 }, (_, hour) => (
    <g key={hour}>
      <line
        x1={hour / 24 * chartWidth}
        x2={hour / 24 * chartWidth}
        y1="0"
        y2={chartHeight}
        stroke="var(--line)"
      />
      <text x={Math.min(hour / 24 * chartWidth + 2, chartWidth - 28)} y={chartHeight + 14}>
        {formatClock(hour * 3600)}
      </text>
    </g>
  ));
  const entityColor = (entity: string) =>
    data.apps.find((app) => app.exe === entity)?.color ??
    data.folders.find((folder) => `f:${folder.id}` === entity)?.color ?? "#9aa1ad";
  const entityName = (entity: string) =>
    data.apps.find((app) => app.exe === entity)?.name ??
    data.folders.find((folder) => `f:${folder.id}` === entity)?.name ?? entity;

  return (
    <div ref={ref} className="dayTimeline">
      {entities.length ? (
        <div className="timelineContent" style={{ minHeight: height }}>
          <div className="timelineLabels">
            {entities.map((entity) => (
              <button type="button" key={entity} onClick={() => onEntity(entity)}>
                <span className="dot" style={{ background: entityColor(entity) }} />
                <span>{entityName(entity)}</span>
              </button>
            ))}
          </div>
          <div className="timelineScroller" onWheel={scroll}>
            <svg width={chartWidth} height={chartHeight + 20}>
              <defs>
                <pattern id="dayOffPattern" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                  <rect width="6" height="6" fill="var(--gap)" />
                  <rect width="1.5" height="6" fill="var(--mut)" fillOpacity=".45" />
                </pattern>
              </defs>
              {detail.off_periods.map((period, index) => (
                <rect
                  key={index}
                  data-tip={`PC off · ${formatDuration(period.end - period.start)}`}
                  x={period.start / 86_400 * chartWidth}
                  y="0"
                  width={(period.end - period.start) / 86_400 * chartWidth}
                  height={chartHeight}
                  fill="url(#dayOffPattern)"
                />
              ))}
              {hours}
              {segments.map((segment, index) => {
                const row = entities.indexOf(segment.exe);
                return (
                  <rect
                    key={`${segment.exe}-${segment.start}-${index}`}
                    data-tip={`${entityName(segment.exe)}${segment.title ? `\n${segment.title}` : ""}\n${formatDuration(segment.end - segment.start)}`}
                    x={segment.start / 86_400 * chartWidth}
                    y={row * rowHeight + 3}
                    width={Math.max(1, (segment.end - segment.start) / 86_400 * chartWidth)}
                    height={20}
                    rx="2"
                    fill={entityColor(segment.exe)}
                    onClick={() => onEntity(segment.exe)}
                  />
                );
              })}
            </svg>
          </div>
        </div>
      ) : (
        <p className="muted">No data for this day.</p>
      )}
    </div>
  );
}

export function dayTotals(segments: FocusSegment[]) {
  const total = segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
  const longest = segments.reduce<FocusSegment | null>(
    (best, segment) => !best || segment.end - segment.start > best.end - best.start ? segment : best,
    null,
  );
  return { total, longest };
}
