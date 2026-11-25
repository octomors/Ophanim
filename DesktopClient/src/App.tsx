import { useCallback, useEffect, useMemo, useState } from "react";
import {
  chooseLogFiles,
  chooseLogFolder,
  getAppSegments,
  getDayData,
  getOverview,
  getState,
  loadDemo,
  loadFilePaths,
  loadFiles,
  loadFolder,
  saveFolders,
  setAppVisibility,
} from "./api/client";
import type { AppDto, ClientStateDto, FocusSegment, FolderDto } from "./api/types";
import { Sidebar } from "./components/Sidebar";
import { DayTimeline, dayTotals } from "./charts/DayTimeline";
import { AppDetailScreen, appScreenRange } from "./charts/DetailScreen";
import { OverviewChart } from "./charts/OverviewChart";
import {
  dateRange,
  formatDate,
  formatDuration,
  getStats,
  visibleSegments,
} from "./lib";
import { useUi } from "./state";
import styles from "./App.module.css";
import "./styles/base.css";

type Tooltip = { x: number; y: number; text: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function App() {
  const data = useUi((state) => state.data);
  const overview = useUi((state) => state.overview);
  const detail = useUi((state) => state.detail);
  const appSegments = useUi((state) => state.appSegments);
  const screen = useUi((state) => state.screen);
  const day = useUi((state) => state.day);
  const entity = useUi((state) => state.entity);
  const span = useUi((state) => state.span);
  const sort = useUi((state) => state.sort);
  const descending = useUi((state) => state.descending);
  const search = useUi((state) => state.search);
  const countUnusedDays = useUi((state) => state.countUnusedDays);
  const loading = useUi((state) => state.loading);
  const error = useUi((state) => state.error);
  const patch = useUi((state) => state.patch);
  const setData = useUi((state) => state.setData);
  const setOverview = useUi((state) => state.setOverview);
  const setDetail = useUi((state) => state.setDetail);
  const setAppSegments = useUi((state) => state.setAppSegments);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [timelineZoom, setTimelineZoom] = useState(1);

  const updateData = useCallback(async (next: ClientStateDto, activeSpan = useUi.getState().span) => {
    setData(next);
    if (next.days.length) {
      try {
        setOverview(await getOverview(activeSpan));
      } catch (reason) {
        patch({ error: `Could not prepare the selected time span: ${errorText(reason)}` });
      }
    } else {
      setOverview({ days: [], segments: [], sessions: [], off_periods: [], apps: {} });
    }
  }, [patch, setData, setOverview]);

  useEffect(() => {
    let active = true;
    getState()
      .then(async (result) => {
        if (!active) return;
        setData(result);
        if (result.days.length) {
          setOverview(await getOverview(useUi.getState().span));
        } else {
          setOverview({ days: [], segments: [], sessions: [], off_periods: [], apps: {} });
        }
      })
      .catch((reason: unknown) => {
        if (active) patch({ loading: false, error: `Could not load DayLogs: ${errorText(reason)}` });
      });
    return () => {
      active = false;
    };
  }, [patch, setData, setOverview]);

  useEffect(() => {
    if (!data || screen !== "day" || !day) return;
    let active = true;
    getDayData(day).then((result) => {
      if (active) setDetail(result);
    }).catch((reason: unknown) => {
      if (active) patch({ error: `Could not load ${formatDate(day)}: ${errorText(reason)}` });
    });
    return () => {
      active = false;
    };
  }, [data, day, screen, patch, setDetail]);

  useEffect(() => {
    if (!data || screen !== "app" || !entity) return;
    const range = appScreenRange(data, span, entity);
    if (!range.start || !range.end) {
      setAppSegments({ segments: [], raw_segments: [] });
      return;
    }
    let active = true;
    getAppSegments(entity, range.start, range.end).then((segments) => {
      if (active) setAppSegments(segments);
    }).catch((reason: unknown) => {
      if (active) patch({ error: `Could not load app activity: ${errorText(reason)}` });
    });
    return () => {
      active = false;
    };
  }, [data, entity, screen, span, patch, setAppSegments]);

  const stats = useMemo(
    () => data ? getStats(data, span, screen === "day" ? day : null) : new Map(),
    [data, span, screen, day],
  );
  const activeSegments = useMemo(
    () => data && overview ? visibleSegments(data, overview.segments) : [],
    [data, overview],
  );

  const setError = (reason: unknown, prefix: string) =>
    patch({ error: `${prefix}: ${errorText(reason)}` });

  const chooseFolder = async () => {
    try {
      const path = await chooseLogFolder();
      if (path) await updateData(await loadFolder(path));
    } catch (reason) {
      setError(reason, "Could not load the selected folder");
    }
  };
  const chooseFiles = async () => {
    try {
      const paths = await chooseLogFiles();
      if (paths?.length) await updateData(await loadFilePaths(paths));
    } catch (reason) {
      setError(reason, "Could not load the selected files");
    }
  };
  const loadSample = async () => {
    try {
      await updateData(await loadDemo());
    } catch (reason) {
      setError(reason, "Could not load demo data");
    }
  };
  const importDroppedFiles = async (files: FileList | File[]) => {
    const accepted = Array.from(files).filter((file) => /\.(ndjson|jsonl|json|txt|log)$/i.test(file.name));
    if (!accepted.length) return;
    try {
      const texts = await Promise.all(accepted.map(async (file) => [file.name, await file.text()] as [string, string]));
      await updateData(await loadFiles(texts));
    } catch (reason) {
      setError(reason, "Could not load dropped files");
    }
  };

  const openDay = (date: string) => {
    patch({ screen: "day", day: date, error: null });
    setTimelineZoom(1);
    setDetail(null);
  };
  const openEntity = (key: string) => {
    patch({ screen: "app", entity: key, error: null });
  };
  const backToOverview = () => patch({ screen: "overview", day: null, entity: null });
  const changeSpan = async (nextSpan: number) => {
    patch({ span: nextSpan });
    if (!data?.days.length) return;
    try {
      setOverview(await getOverview(nextSpan));
    } catch (reason) {
      setError(reason, "Could not change the time span");
    }
  };
  const changeVisibility = async (app: AppDto, show: boolean) => {
    if (!data) return;
    const next = { ...data, apps: data.apps.map((item) => item.exe === app.exe ? { ...item, show } : item) };
    setData(next);
    try {
      await setAppVisibility(app.exe, show);
    } catch (reason) {
      setError(reason, "Could not save app visibility");
    }
  };
  const changeFolders = async (folders: FolderDto[], nextId: number) => {
    if (!data) return;
    try {
      setData(await saveFolders(folders, nextId));
      setOverview(await getOverview(span));
    } catch (reason) {
      setError(reason, "Could not save folders");
    }
  };
  const dropAppOutsideFolder = async (appKey: string) => {
    if (!data) return;
    const folders = data.folders
      .map((folder) => ({ ...folder, items: folder.items.filter((item) => item !== appKey) }))
      .filter((folder) => folder.items.length > 0);
    if (folders.length === data.folders.length && folders.every((folder, index) => folder.items.length === data.folders[index].items.length)) {
      return;
    }
    await changeFolders(folders, Math.max(1, ...folders.map((folder) => folder.id + 1)));
  };

  const handleDrop = (event: React.DragEvent) => {
    const files = event.dataTransfer.files;
    if (files.length) {
      event.preventDefault();
      void importDroppedFiles(files);
      return;
    }
    const draggedApp = event.dataTransfer.getData("text/plain");
    if (!draggedApp || (event.target as HTMLElement).closest("[data-app], [data-folder], aside")) return;
    event.preventDefault();
    void dropAppOutsideFolder(draggedApp);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const element = (event.target as HTMLElement).closest<HTMLElement>("[data-tip]");
    const text = element?.dataset.tip;
    if (!text) {
      setTooltip(null);
      return;
    }
    setTooltip({
      x: Math.min(event.clientX + 14, window.innerWidth - 330),
      y: Math.min(event.clientY + 14, window.innerHeight - 80),
      text,
    });
  };

  if (loading) {
    return <div className={styles.root}><div className={styles.empty}>Loading DayLogs…</div></div>;
  }

  return (
    <div
      className={styles.root}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setTooltip(null)}
      onDragOver={(event) => {
        if (event.dataTransfer.files.length || event.dataTransfer.types.includes("text/plain")) event.preventDefault();
      }}
      onDrop={handleDrop}
    >
      <header className={styles.header}>
        <strong className={styles.headerTitle}>Ophanim</strong>
        <span className={styles.spacer} />
        {data?.bad_lines ? <span className={styles.muted}>Skipped bad lines: {data.bad_lines}</span> : null}
        <button type="button" onClick={() => void chooseFolder()}>Log folder</button>
        <button type="button" onClick={() => void chooseFiles()}>Files</button>
        <button type="button" onClick={() => void loadSample()}>Demo</button>
      </header>
      <div className={`${styles.layout} ${screen === "app" ? "" : ""}`}>
        {data && (
          <Sidebar
            data={data}
            stats={stats}
            screen={screen}
            day={day}
            entity={entity}
            span={span}
            sort={sort}
            descending={descending}
            search={search}
            onSpan={(value) => void changeSpan(value)}
            onSort={(value) => patch({ sort: value })}
            onDirection={() => patch({ descending: !descending })}
            onSearch={(value) => patch({ search: value })}
            onAppVisibility={(app, show) => void changeVisibility(app, show)}
            onFolders={(folders, nextId) => void changeFolders(folders, nextId)}
            onOpenDay={(value) => void openDay(value)}
            onOpenEntity={openEntity}
          />
        )}
        <main className={styles.mainContent}>
          {error && <div className={styles.error} role="alert">{error}</div>}
          {!data?.days.length ? (
            <section className={styles.empty}>
              <h2>Connect your logs</h2>
              <p className={styles.muted}>
                Pick the DayLogs folder (%AppData%\Ophanim\DayLogs) or NDJSON files.
                Data is read locally and never uploaded.
              </p>
              <button type="button" onClick={() => void chooseFolder()}>Choose folder</button>
              <button type="button" onClick={() => void chooseFiles()}>Choose files</button>
              <button type="button" onClick={() => void loadSample()}>Demo data</button>
              <p className={styles.muted}>You can also drop files here.</p>
            </section>
          ) : screen === "day" ? (
            <DayScreen
              data={data}
              detail={detail}
              day={day}
              zoom={timelineZoom}
              onZoom={setTimelineZoom}
              onBack={backToOverview}
              onEntity={openEntity}
            />
          ) : screen === "app" && entity ? (
            <AppDetailScreen
              data={data}
              entity={entity}
              segments={appSegments?.segments ?? []}
              rawSegments={appSegments?.raw_segments ?? []}
              span={span}
              countUnusedDays={countUnusedDays}
              onCountUnusedDays={(value) => patch({ countUnusedDays: value })}
              onBack={backToOverview}
              onDay={(value) => void openDay(value)}
            />
          ) : overview ? (
            <OverviewScreen
              data={data}
              segments={activeSegments}
              onView={(value) => patch({ view: value })}
              onEntity={openEntity}
              onDay={(value) => void openDay(value)}
            />
          ) : null}
        </main>
      </div>
      {tooltip && (
        <div className={styles.tooltip} style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

function OverviewScreen({
  data,
  segments,
  onView,
  onEntity,
  onDay,
}: {
  data: ClientStateDto;
  segments: FocusSegment[];
  onView: (view: "heatmap" | "histogram" | "donut") => void;
  onEntity: (entity: string) => void;
  onDay: (day: string) => void;
}) {
  const overview = useUi((state) => state.overview);
  const view = useUi((state) => state.view);
  if (!overview) return null;
  const totalsByDay = new Map<string, number>();
  const totalsByEntity = new Map<string, number>();
  segments.forEach((segment) => {
    const seconds = segment.end - segment.start;
    totalsByDay.set(segment.day, (totalsByDay.get(segment.day) ?? 0) + seconds);
    totalsByEntity.set(segment.exe, (totalsByEntity.get(segment.exe) ?? 0) + seconds);
  });
  const total = [...totalsByEntity.values()].reduce((sum, value) => sum + value, 0);
  const mostActive = [...totalsByDay].sort((a, b) => b[1] - a[1])[0];
  const hidden = data.apps.filter((app) => {
    const folder = data.folders.find((item) => item.items.includes(app.exe) && item.on);
    return !app.show && !folder;
  }).length;
  const dates = dateRange(data, useUi.getState().span);
  const activeView = view === "heatmap" && dates.length > 60 ? "histogram" : view;

  return (
    <>
      <div className={styles.tiles}>
        <div className={styles.tile}>
          <small>View</small>
          <select
            aria-label="View"
            value={activeView}
            onChange={(event) => onView(event.target.value as "heatmap" | "histogram" | "donut")}
          >
            <option value="heatmap" disabled={dates.length > 60}>Heatmap</option>
            <option value="histogram">Histogram</option>
            <option value="donut">Donut chart</option>
          </select>
        </div>
        <div className={styles.tile} data-tip={`Total time of the selected apps${hidden ? ` (${hidden} hidden)` : ""}`}>
          <small>Screen time</small>
          <b>{formatDuration(total)}</b>
        </div>
        <div className={styles.tile}>
          <small>Active days</small>
          <b>{totalsByDay.size}</b>
        </div>
        <div
          className={`${styles.tile} ${styles.clickable}`}
          data-tip={mostActive ? `Open ${formatDate(mostActive[0])}` : undefined}
          onClick={() => mostActive && onDay(mostActive[0])}
        >
          <small>Most active day</small>
          <b>{mostActive ? formatDuration(mostActive[1]) : "—"}</b>
          {mostActive && <span className={styles.muted}>{formatDate(mostActive[0])}</span>}
        </div>
        <div className={styles.tile}>
          <small>Focus switches</small>
          <b>{segments.length}</b>
        </div>
        <div className={styles.tile}>
          <small>Daemon</small>
          <b className={data.last_event ? "daemonOnline" : styles.muted}>●</b>
          <span className={styles.muted}>
            {data.last_event
              ? `last event ${formatDate(data.last_event.slice(0, 10))} ${data.last_event.slice(11, 16)}`
              : "no events"}
          </span>
        </div>
      </div>
      <section className={`${styles.card} ${styles.chartCard}`}>
        <OverviewChart data={data} overview={overview} onEntity={onEntity} onDay={onDay} />
      </section>
    </>
  );
}

function DayScreen({
  data,
  detail,
  day,
  zoom,
  onZoom,
  onBack,
  onEntity,
}: {
  data: ClientStateDto;
  detail: import("./api/types").DayDetailDto | null;
  day: string | null;
  zoom: number;
  onZoom: (zoom: number) => void;
  onBack: () => void;
  onEntity: (entity: string) => void;
}) {
  const segments = useMemo(
    () => detail ? visibleSegments(data, detail.segments) : [],
    [data, detail],
  );
  const totals = dayTotals(segments);
  const sessionTime = detail?.sessions.reduce((sum, session) => sum + session.end - session.start, 0) ?? 0;
  const sessions = detail?.sessions.map((session) =>
    `${formatClockString(session.start)}–${formatClockString(session.end)}`,
  ) ?? [];
  const visibleAppKeys = new Set(segments.map((segment) => segment.exe));
  const launched = detail
    ? Object.entries(detail.launches).reduce((sum, [exe, count]) => {
        const owner = data.folders.find((folder) => folder.on && folder.items.includes(exe));
        return sum + ((owner ? visibleAppKeys.has(`f:${owner.id}`) : visibleAppKeys.has(exe)) ? count : 0);
      }, 0)
    : 0;

  return (
    <>
      <div className={styles.topBar}><button type="button" onClick={onBack}>← Back</button></div>
      <div className={styles.tiles}>
        <div className={styles.tile} data-tip={`PC on:\n${sessions.join("\n") || "no sessions"}`}>
          <small>Session time</small><b>{formatDuration(sessionTime)}</b>
        </div>
        <div className={styles.tile} data-tip="Total time of the selected apps">
          <small>Screen time</small><b>{formatDuration(totals.total)}</b>
        </div>
        <div className={styles.tile}>
          <small>Focus switches</small><b>{segments.length}</b>
        </div>
        <div className={styles.tile}>
          <small>Longest focus</small>
          <b>{formatDuration(totals.longest ? totals.longest.end - totals.longest.start : 0)}</b>
          <span className={styles.muted}>{totals.longest ? entityName(data, totals.longest.exe) : ""}</span>
        </div>
        <div className={styles.tile}>
          <small>Apps launched</small><b>{launched}</b>
        </div>
      </div>
      <section className={`${styles.card} ${styles.chartCard}`}>
        {detail && day ? (
          <DayTimeline
            data={data}
            detail={detail}
            zoom={zoom}
            onZoom={onZoom}
            onEntity={onEntity}
          />
        ) : (
          <div className={styles.muted}>Loading day…</div>
        )}
      </section>
    </>
  );
}

function entityName(data: ClientStateDto, entity: string) {
  return data.apps.find((app) => app.exe === entity)?.name ??
    data.folders.find((folder) => `f:${folder.id}` === entity)?.name ?? entity;
}

function formatClockString(seconds: number) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}`;
}
