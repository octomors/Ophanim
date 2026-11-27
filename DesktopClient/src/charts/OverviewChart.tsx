import type { ClientStateDto, FocusSegment, OverviewDto } from "../api/types";
import { memo } from "react";
import { useUi } from "../state";
import {
  formatAxisDate,
  formatDate,
  formatDuration,
  months,
  segmentClusters,
} from "../lib";
import type { VisibleDailyAggregates } from "../lib";
import { useSize } from "./useSize";

type Props = {
  data: ClientStateDto;
  overview: OverviewDto;
  dailyAggregates: VisibleDailyAggregates;
  segments: FocusSegment[];
  onEntity: (key: string) => void;
  onDay: (date: string) => void;
};

const label = (value: number) => String(value).padStart(2, "0");
const gray = "#9aa1ad";

export const OverviewChart = memo(function OverviewChart({ data, overview, dailyAggregates, segments, onEntity, onDay }: Props) {
  const view = useUi((state) => state.view);
  const { ref, width, height } = useSize<HTMLDivElement>();
  const dates = overview.days.map((item) => item.date);
  const mode = view === "heatmap" && dates.length > 60 ? "histogram" : view;
  const open = (event: React.MouseEvent<SVGElement>) => {
    const target = event.target as SVGElement;
    const entity = target.dataset.entity;
    const date = target.dataset.day;
    if (entity) onEntity(entity);
    else if (date) onDay(date);
  };

  return (
    <div ref={ref} className="chartViewport">
      {width > 0 && height > 0 && (
        mode === "heatmap"
          ? <Heatmap data={data} overview={overview} segments={segments} width={width} height={height} onClick={open} />
          : mode === "histogram"
            ? <Histogram data={data} dates={dates} dailyAggregates={dailyAggregates} width={width} height={height} onClick={open} />
            : <Donut data={data} dailyAggregates={dailyAggregates} width={width} height={height} onEntity={onEntity} />
      )}
      {view === "heatmap" && dates.length > 60 && (
        <span className="chartNote">Heatmap is available for spans up to 60 days.</span>
      )}
    </div>
  );
});

function Heatmap({
  data,
  overview,
  segments,
  width,
  height,
  onClick,
}: {
  data: ClientStateDto;
  overview: OverviewDto;
  segments: FocusSegment[];
  width: number;
  height: number;
  onClick: (event: React.MouseEvent<SVGElement>) => void;
}) {
  const x0 = 44;
  const top = 10;
  const bottom = 22;
  const plotHeight = Math.max(1, height - top - bottom);
  const cellWidth = (width - x0) / Math.max(1, overview.days.length);
  const y = (seconds: number) => top + plotHeight - seconds / 86_400 * plotHeight;
  const byDay = new Map<string, FocusSegment[]>();
  segments.forEach((segment) => {
    const list = byDay.get(segment.day) ?? [];
    list.push(segment);
    byDay.set(segment.day, list);
  });
  const colors = new Map(data.apps.map((app) => [app.exe, app.color]));
  const names = new Map(data.apps.map((app) => [app.exe, app.name]));
  data.folders.forEach((folder) => {
    colors.set(`f:${folder.id}`, folder.color);
    names.set(`f:${folder.id}`, folder.name);
  });
  const defs: Array<{ id: string; colors: string[] }> = [];
  const blocks = overview.days.flatMap((day, column) => {
    const x = x0 + column * cellWidth;
    const off = day.off_periods.map((period, index) => (
      <rect
        key={`off-${day.date}-${index}`}
        data-day={day.date}
        data-tip={`PC off · ${formatDuration(period.end - period.start)}`}
        x={x}
        y={y(period.end)}
        width={Math.max(1, cellWidth - 1)}
        height={Math.max(0, y(period.start) - y(period.end))}
        fill="url(#offPattern)"
      />
    ));
    const clusters = segmentClusters(byDay.get(day.date) ?? []);
    const focused = clusters.map((cluster, index) => {
      const sums = new Map<string, number>();
      cluster.segments.forEach((segment) => {
        sums.set(segment.exe, (sums.get(segment.exe) ?? 0) + segment.end - segment.start);
      });
      const ranked = [...sums].sort((a, b) => b[1] - a[1]);
      const dominant = ranked[0]?.[0];
      if (!dominant) return null;
      const blockColor = ranked.length > 1
        ? (() => {
            const id = `stripe-${day.date.replace(/-/g, "")}-${column}-${index}`;
          defs.push({
            id,
            colors: ranked.slice(0, 4).map(([entity]) => colors.get(entity) ?? gray),
          });
            return `url(#${id})`;
          })()
        : colors.get(dominant) ?? gray;
      const description = `${formatDate(day.date)}\n${ranked.map(([entity, seconds]) => {
        return `${names.get(entity) ?? entity}: ${formatDuration(seconds)}`;
      }).join("\n")}${cluster.segments.length === 1 && cluster.segments[0].title ? `\n${cluster.segments[0].title}` : ""}`;
      const rectHeight = Math.max(y(cluster.start) - y(cluster.end), ranked.length > 1 ? 3 : 1.5);
      return (
        <rect
          key={`${day.date}-${index}`}
          data-entity={dominant}
          data-tip={description}
          x={x}
          y={y(cluster.end)}
          width={Math.max(1, cellWidth - 1)}
          height={rectHeight}
          fill={blockColor}
        />
      );
    });
    return [...off, ...focused];
  });

  const labelsEvery = Math.max(1, Math.ceil(overview.days.length / Math.max(1, Math.floor((width - x0) / 50))));
  return (
    <svg width={width} height={height} onClick={onClick} role="img" aria-label="Screen time heatmap">
      <defs>
        <pattern id="offPattern" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="var(--gap)" />
          <rect width="1.5" height="6" fill="var(--mut)" fillOpacity=".45" />
        </pattern>
        {defs.map(({ id, colors: stripeColors }) => (
          <pattern
            key={id}
            id={id}
            width={stripeColors.length * 3}
            height="12"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            {stripeColors.map((color, index) => (
              <rect key={color + index} x={index * 3} width="3" height="12" fill={color} />
            ))}
          </pattern>
        ))}
      </defs>
      {Array.from({ length: 25 }, (_, hour) => (
        <g key={hour}>
          <line x1={x0} x2={width} y1={y(hour * 3600)} y2={y(hour * 3600)} stroke="var(--line)" />
          <text x={x0 - 6} y={y(hour * 3600) + 3} textAnchor="end">{label(hour)}:00</text>
        </g>
      ))}
      {blocks}
      {overview.days.map((day, index) => index % labelsEvery === 0 && (
        <text
          key={day.date}
          data-day={day.date}
          x={x0 + index * cellWidth}
          y={height - 4}
          onClick={onClick}
        >
          {formatAxisDate(day.date)}
        </text>
      ))}
    </svg>
  );
}

function Histogram({
  data,
  dates,
  dailyAggregates,
  width,
  height,
  onClick,
}: {
  data: ClientStateDto;
  dates: string[];
  dailyAggregates: VisibleDailyAggregates;
  width: number;
  height: number;
  onClick: (event: React.MouseEvent<SVGElement>) => void;
}) {
  const monthly = dates.length > 120;
  const keys = [...new Set(dates.map((date) => monthly ? date.slice(0, 7) : date))];
  const entityTime = new Map<string, Map<string, number>>();
  dailyAggregates.forEach((entities, date) => {
    const key = monthly ? date.slice(0, 7) : date;
    const map = entityTime.get(key) ?? new Map<string, number>();
    entities.forEach((aggregate, entity) => {
      map.set(entity, (map.get(entity) ?? 0) + aggregate.seconds);
    });
    entityTime.set(key, map);
  });
  const total = (key: string) => [...(entityTime.get(key)?.values() ?? [])].reduce((sum, value) => sum + value, 0);
  const top = Math.max(1, Math.ceil(Math.max(0, ...keys.map(total)) / 3600));
  const step = Math.max(1, Math.ceil(top / Math.max(1, Math.floor((height - 30) / 18))));
  const x0 = 44;
  const topPad = 8;
  const plotHeight = Math.max(1, height - topPad - 22);
  const barWidth = (width - x0) / Math.max(1, keys.length);
  const y = (seconds: number) => topPad + plotHeight - seconds / (top * 3600) * plotHeight;
  const colors = new Map(data.apps.map((app) => [app.exe, app.color]));
  const names = new Map(data.apps.map((app) => [app.exe, app.name]));
  data.folders.forEach((folder) => {
    colors.set(`f:${folder.id}`, folder.color);
    names.set(`f:${folder.id}`, folder.name);
  });
  const appName = (key: string) => names.get(key) ?? key;
  const labelsEvery = Math.max(1, Math.ceil(keys.length / Math.max(1, Math.floor((width - x0) / 50))));

  return (
    <svg width={width} height={height} onClick={onClick} role="img" aria-label="Screen time histogram">
      {Array.from({ length: top + 1 }, (_, hour) => hour % step === 0 && (
        <g key={hour}>
          <line x1={x0} x2={width} y1={y(hour * 3600)} y2={y(hour * 3600)} stroke="var(--line)" />
          <text x={x0 - 6} y={y(hour * 3600) + 3} textAnchor="end">{hour}h</text>
        </g>
      ))}
      {keys.map((key, index) => {
        const entries = [...(entityTime.get(key) ?? new Map())].sort((a, b) => b[1] - a[1]);
        const big = entries.filter(([, seconds]) => seconds >= top * 3600 * 0.03);
        const small = entries.filter(([, seconds]) => seconds < top * 3600 * 0.03);
        let currentY = y(0);
        const rects = big.map(([entity, seconds]) => {
          const barHeight = seconds / (top * 3600) * plotHeight;
          currentY -= barHeight;
          return (
            <rect
              key={entity}
              data-entity={entity}
              data-tip={`${monthly ? key : formatDate(key)}\n${appName(entity)}: ${formatDuration(seconds)}`}
              x={x0 + index * barWidth}
              y={currentY}
              width={Math.max(1, barWidth - 1)}
              height={barHeight}
              fill={colors.get(entity) ?? gray}
            />
          );
        });
        if (small.length) {
          const seconds = small.reduce((sum, item) => sum + item[1], 0);
          const barHeight = seconds / (top * 3600) * plotHeight;
          currentY -= barHeight;
          rects.push(
            <rect
              key="other"
              data-day={monthly ? undefined : key}
              data-tip={`${monthly ? key : formatDate(key)} · Other\n${small.map(([entity, value]) => `${appName(entity)}: ${formatDuration(value)}`).join("\n")}`}
              x={x0 + index * barWidth}
              y={currentY}
              width={Math.max(1, barWidth - 1)}
              height={barHeight}
              fill={gray}
            />,
          );
        }
        return <g key={key}>{rects}</g>;
      })}
      {keys.map((key, index) => index % labelsEvery === 0 && (
        <text
          key={key}
          data-day={monthly ? undefined : key}
          x={x0 + index * barWidth}
          y={height - 4}
        >
          {monthly ? `${months[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}` : formatAxisDate(key)}
        </text>
      ))}
    </svg>
  );
}

function Donut({
  data,
  dailyAggregates,
  width,
  height,
  onEntity,
}: {
  data: ClientStateDto;
  dailyAggregates: VisibleDailyAggregates;
  width: number;
  height: number;
  onEntity: (key: string) => void;
}) {
  const totals = new Map<string, number>();
  dailyAggregates.forEach((entities) => entities.forEach((aggregate, entity) => {
    totals.set(entity, (totals.get(entity) ?? 0) + aggregate.seconds);
  }));
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0) || 1;
  const entries = [...totals].sort((a, b) => b[1] - a[1]);
  const grouped = entries.filter(([, value]) => value / total >= 0.02);
  const other = entries.filter(([, value]) => value / total < 0.02);
  if (other.length) grouped.push(["other", other.reduce((sum, item) => sum + item[1], 0)]);
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const colors = new Map(data.apps.map((app) => [app.exe, app.color]));
  const names = new Map(data.apps.map((app) => [app.exe, app.name]));
  data.folders.forEach((folder) => {
    colors.set(`f:${folder.id}`, folder.color);
    names.set(`f:${folder.id}`, folder.name);
  });
  const name = (entity: string) => {
    if (entity === "other") return "Other";
    return names.get(entity) ?? entity;
  };
  const size = Math.min(height, width * 0.55);

  return (
    <div className="donutLayout">
      <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label="Screen time share">
        {grouped.map(([entity, seconds]) => {
          const length = seconds / total * circumference;
          const color = colors.get(entity) ?? gray;
          const startOffset = offset;
          offset += length;
          return (
            <circle
              key={entity}
              data-entity={entity === "other" ? undefined : entity}
              data-tip={entity === "other"
                ? `Other\n${other.map(([item, value]) => `${name(item)}: ${formatDuration(value)}`).join("\n")}`
                : `${name(entity)}: ${formatDuration(seconds)}`}
              onClick={() => entity !== "other" && onEntity(entity)}
              r={radius}
              cx="100"
              cy="100"
              fill="none"
              stroke={color}
              strokeWidth="30"
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-startOffset}
              transform="rotate(-90 100 100)"
            />
          );
        })}
        <text x="100" y="104" textAnchor="middle" className="donutTotal">{formatDuration(total)}</text>
      </svg>
      <div className="legend">
        {grouped.map(([entity, seconds]) => (
          <button
            type="button"
            key={entity}
            data-tip={entity === "other"
              ? `Other\n${other.map(([item, value]) => `${name(item)}: ${formatDuration(value)}`).join("\n")}`
              : `${name(entity)}: ${formatDuration(seconds)}`}
            onClick={() => entity !== "other" && onEntity(entity)}
          >
            <span className="dot" style={{ background: colors.get(entity) ?? gray }} />
            <span>{name(entity)}</span>
            <span className="muted">{formatDuration(seconds)} · {(seconds / total * 100).toFixed(1)}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}
