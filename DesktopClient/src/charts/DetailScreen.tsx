import type { ClientStateDto, FocusSegment } from "../api/types";
import { dateRange, formatDate, formatDuration, months, titleWithoutAppSuffix, weekday, weekdays } from "../lib";
import styles from "../App.module.css";
import { useSize } from "./useSize";

type AppProps = {
  data: ClientStateDto;
  entity: string;
  segments: FocusSegment[];
  rawSegments: FocusSegment[];
  span: number;
  countUnusedDays: boolean;
  onCountUnusedDays: (value: boolean) => void;
  onBack: () => void;
  onDay: (day: string) => void;
};

export function AppDetailScreen({
  data,
  entity,
  segments,
  rawSegments,
  span,
  countUnusedDays,
  onCountUnusedDays,
  onBack,
  onDay,
}: AppProps) {
  const app = data.apps.find((item) => item.exe === entity);
  const folder = data.folders.find((item) => `f:${item.id}` === entity);
  const name = folder?.name ?? app?.name ?? entity;
  const range = dateRange(data, span);
  const perDay = new Map<string, number>();
  const hours = Array(24).fill(0) as number[];
  const weekdaysSeconds = Array(7).fill(0) as number[];
  const rawTitles = new Map<string, number>();
  let longest = 0;
  let longestDay: string | null = null;
  let total = 0;

  for (const segment of segments) {
    const seconds = segment.end - segment.start;
    total += seconds;
    perDay.set(segment.day, (perDay.get(segment.day) ?? 0) + seconds);
    weekdaysSeconds[weekday(segment.day)] += seconds;
    for (let hour = Math.floor(segment.start / 3600); hour * 3600 < segment.end; hour += 1) {
      hours[hour] += Math.min(segment.end, hour * 3600 + 3600) - Math.max(segment.start, hour * 3600);
    }
    if (seconds > longest) {
      longest = seconds;
      longestDay = segment.day;
    }
  }
  for (const segment of rawSegments) {
    const title = titleWithoutAppSuffix(segment.title || "(no title)");
    rawTitles.set(title, (rawTitles.get(title) ?? 0) + segment.end - segment.start);
  }
  const maxDay = [...perDay].sort((a, b) => b[1] - a[1])[0];
  const divisor = countUnusedDays ? range.length : perDay.size || 1;
  const dayCounts = Array(7).fill(0) as number[];
  (countUnusedDays ? range : [...perDay.keys()]).forEach((date) => {
    dayCounts[weekday(date)] += 1;
  });
  const weekdayAverage = weekdaysSeconds.map((seconds, index) =>
    seconds / (dayCounts[index] || 1),
  );
  const average = total / Math.max(1, divisor);
  const averageFocus = total / Math.max(1, segments.length);
  const entityColor = folder?.color ?? app?.color ?? "#2f6fed";
  const { ref, height } = useSize<HTMLDivElement>();
  const calendar = range.slice(-371);
  const maxHour = Math.max(1, ...hours);
  const maxDaySeconds = Math.max(1, ...perDay.values());
  const maxWeekday = Math.max(1, ...weekdayAverage);
  const calendarDays = range.slice(-371);
  const weeks = Math.ceil((calendarDays.length + (calendarDays.length ? weekday(calendarDays[0]) : 0)) / 7);
  const available = Math.max(400, height - 24);
  let ringSize = (available - 254 + 210 / Math.max(1, weeks)) / (1 + 7 / Math.max(1, weeks));
  if ((ringSize - 30) / Math.max(1, weeks) > 13) ringSize = available - 345;
  const size = Math.max(160, Math.min(420, Math.floor(ringSize)));

  return (
    <div className={styles.appScreen}>
      <section className={styles.appMetrics}>
        <button type="button" onClick={onBack}>← Back</button>
        <h1>{name}</h1>
        <div className={styles.exeLabel}>{folder ? `Folder · ${folder.items.length} apps` : entity}</div>
        <div className={styles.metricPair}>
          <Tile title="Total" value={formatDuration(total)} />
          <Tile
            title="Max per day"
            value={maxDay ? formatDuration(maxDay[1]) : "—"}
            detail={maxDay ? formatDate(maxDay[0]) : ""}
            onClick={maxDay ? () => onDay(maxDay[0]) : undefined}
          />
        </div>
        <div className={styles.metricPair}>
          <Tile
            title="Average per day"
            value={formatDuration(average)}
            detail={`over ${divisor} days (${perDay.size} active of ${range.length} in range)`}
            tooltip={`Averaged over ${divisor} days (${perDay.size} active of ${range.length} in range)`}
            extra={
              <label>
                <input
                  type="checkbox"
                  checked={countUnusedDays}
                  onChange={(event) => onCountUnusedDays(event.target.checked)}
                />
                count unused days
              </label>
            }
          />
          <Tile
            title="Avg / max focus"
            value={`${formatDuration(averageFocus)} / ${formatDuration(longest)}`}
            detail={longestDay ? formatDate(longestDay) : ""}
            onClick={longestDay ? () => onDay(longestDay) : undefined}
          />
        </div>
      </section>
      <div ref={ref} className={styles.detailCharts} style={{ width: size + 24 }}>
        <section className={styles.ringCard} style={{ height: size + 40 }}>
          <small>Hours of day</small>
          <svg viewBox="0 0 270 270" style={{ width: size, height: size }}>
            {hours.map((seconds, hour) => {
              const start = hour / 24 * Math.PI * 2 - Math.PI / 2;
              const end = (hour + 1) / 24 * Math.PI * 2 - Math.PI / 2;
              const point = (radius: number, angle: number) =>
                `${135 + radius * Math.cos(angle)} ${135 + radius * Math.sin(angle)}`;
              return (
                <path
                  key={hour}
                  data-tip={`${String(hour).padStart(2, "0")}:00–${String(hour + 1).padStart(2, "0")}:00\n${formatDuration(seconds)} total`}
                  d={`M${point(62, start)} L${point(94, start)} A94 94 0 0 1 ${point(94, end)} L${point(62, end)} A62 62 0 0 0 ${point(62, start)}Z`}
                  fill={entityColor}
                  fillOpacity={0.08 + 0.92 * seconds / maxHour}
                />
              );
            })}
            {Array.from({ length: 8 }, (_, index) => index * 3).map((hour) => {
              const angle = hour / 24 * Math.PI * 2 - Math.PI / 2;
              const x = 135 + 110 * Math.cos(angle);
              const y = 135 + 110 * Math.sin(angle);
              return <text key={hour} x={x} y={y + 3} textAnchor="middle">{hour ? `${String(hour).padStart(2, "0")}:00` : "00:00 / 24:00"}</text>;
            })}
          </svg>
        </section>
        <section className={styles.calendarCard}>
          <small>Calendar</small>
          <Calendar
            dates={calendar}
            values={perDay}
            color={entityColor}
            max={maxDaySeconds}
            onDay={onDay}
          />
        </section>
        <section className={styles.weekdayCard}>
          <small>By weekday</small>
          <div className={styles.weekdayBars}>
            {[1, 2, 3, 4, 5, 6, 0].map((index) => (
              <div
                key={index}
                className={styles.weekdayBar}
                data-tip={`${weekdays[index]}: avg ${formatDuration(weekdayAverage[index])}${countUnusedDays ? " over " : " on "}${dayCounts[index]} days`}
              >
                <div className={styles.weekdayTrack}>
                  <div
                    style={{
                      height: `${weekdayAverage[index] / maxWeekday * 100}%`,
                      background: entityColor,
                    }}
                  />
                </div>
                <span>{weekdays[index]}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className={styles.titleList}>
        <small>Window titles</small>
        {[...rawTitles].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([title, seconds]) => (
          <div className={styles.titleRow} key={title}>
            <span>{title}</span>
            <span>{formatDuration(seconds)} · {total ? (seconds / total * 100).toFixed(0) : 0}%</span>
          </div>
        ))}
      </section>
    </div>
  );
}

function Tile({
  title,
  value,
  detail,
  tooltip,
  extra,
  onClick,
}: {
  title: string;
  value: string;
  detail?: string;
  tooltip?: string;
  extra?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      className={`${styles.tile} ${onClick ? styles.clickable : ""}`}
      data-tip={tooltip}
      onClick={onClick}
    >
      <small>{title}</small>
      <b>{value}</b>
      {detail && <span className={styles.muted}>{detail}</span>}
      {extra}
    </div>
  );
}

function Calendar({
  dates,
  values,
  color,
  max,
  onDay,
}: {
  dates: string[];
  values: Map<string, number>;
  color: string;
  max: number;
  onDay: (day: string) => void;
}) {
  const startWeekday = dates.length ? weekday(dates[0]) : 0;
  const weeks = Math.ceil((dates.length + startWeekday) / 7);
  const side = 30;
  const size = Math.max(3, Math.min(13, (220 - side) / Math.max(1, weeks)));
  let previousMonth = -1;
  return (
    <svg width={Math.max(160, side + weeks * size)} height={14 + 7 * size}>
      {dates.map((date, index) => {
        const offset = index + startWeekday;
        const month = Number(date.slice(5, 7));
        const x = side + Math.floor(offset / 7) * size;
        const value = values.get(date) ?? 0;
        const showMonth = month !== previousMonth && (offset % 7 < 3 || index === 0);
        if (showMonth) previousMonth = month;
        return (
          <g key={date}>
            {showMonth && <text x={x} y="9">{months[month - 1]}</text>}
            <rect
              data-tip={`${formatDate(date)}: ${formatDuration(value)}`}
              x={x}
              y={14 + offset % 7 * size}
              width={Math.max(size - 1.2, 2)}
              height={Math.max(size - 1.2, 2)}
              rx="1"
              fill={value ? color : "var(--gap)"}
              fillOpacity={value ? 0.2 + 0.8 * value / max : 1}
              onClick={() => onDay(date)}
            />
          </g>
        );
      })}
      {[1, 3, 5].map((index) => (
        <text key={index} x="0" y={14 + index * size + Math.min(size, 10)}>{weekdays[index]}</text>
      ))}
    </svg>
  );
}

export function appScreenRange(data: ClientStateDto, span: number, entity: string) {
  const dates = dateRange(data, span);
  if (!dates.length) return { start: "", end: "" };
  const folder = data.folders.find((item) => `f:${item.id}` === entity);
  return { start: dates[0], end: dates[dates.length - 1], folder };
}
