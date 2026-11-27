import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  setAppsVisibility,
} from "./api/client";
import type {
  AppDayAggregate,
  AppDto,
  ClientStateDto,
  EntitySegmentsDto,
  FocusSegment,
  FolderDto,
  OverviewDto,
} from "./api/types";
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
  visibleDailyAggregates,
} from "./lib";
import { moveApp } from "./folderRules";
import type { FolderDropTarget } from "./folderRules";
import { useUi } from "./state";
import type { SortKey } from "./state";
import styles from "./App.module.css";
import "./styles/base.css";

type Tooltip = { x: number; y: number; text: string };
type CachedHeatmap = {
  sourceDays: ClientStateDto["days"];
  start: string;
  end: string;
  overview: OverviewDto;
};
type LoadedAppSegments = {
  key: string;
  segments: EntitySegmentsDto;
};
type PointerDrag = {
  pointerId: number;
  app: string;
  startX: number;
  startY: number;
  element: HTMLElement;
  active: boolean;
  cancelled: boolean;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function App() {
  const data = useUi((state) => state.data);
  const detail = useUi((state) => state.detail);
  const screen = useUi((state) => state.screen);
  const day = useUi((state) => state.day);
  const entity = useUi((state) => state.entity);
  const span = useUi((state) => state.span);
  const view = useUi((state) => state.view);
  const sort = useUi((state) => state.sort);
  const descending = useUi((state) => state.descending);
  const search = useUi((state) => state.search);
  const countUnusedDays = useUi((state) => state.countUnusedDays);
  const loading = useUi((state) => state.loading);
  const error = useUi((state) => state.error);
  const patch = useUi((state) => state.patch);
  const setData = useUi((state) => state.setData);
  const setDetail = useUi((state) => state.setDetail);
  const dataRevision = useRef(0);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [cachedHeatmap, setCachedHeatmap] = useState<CachedHeatmap | null>(null);
  const [loadedAppSegments, setLoadedAppSegments] = useState<LoadedAppSegments | null>(null);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [draggedApp, setDraggedApp] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<FolderDropTarget | null>(null);
  const [folderToRename, setFolderToRename] = useState<number | null>(null);
  const pointerDrag = useRef<PointerDrag | null>(null);
  const suppressClick = useRef(false);

  const setLoadedData = useCallback((next: ClientStateDto) => {
    dataRevision.current += 1;
    setData(next);
  }, [setData]);

  const updateData = useCallback((next: ClientStateDto) => {
    setLoadedData(next);
    setCachedHeatmap(null);
    setLoadedAppSegments(null);
  }, [setLoadedData]);
  const folderMembershipKey = useMemo(
    () => data ? JSON.stringify(data.folders.map(({ id, items }) => [id, items])) : "",
    [data?.folders],
  );

  useEffect(() => {
    let active = true;
    getState()
      .then((result) => {
        if (!active) return;
        setLoadedData(result);
      })
      .catch((reason: unknown) => {
        if (active) patch({ loading: false, error: `Could not load DayLogs: ${errorText(reason)}` });
      });
    return () => {
      active = false;
    };
  }, [patch, setLoadedData]);

  useEffect(() => {
    if (!data || screen !== "day" || !day) return;
    let active = true;
    getDayData(day, dataRevision.current, folderMembershipKey).then((result) => {
      if (active) setDetail(result);
    }).catch((reason: unknown) => {
      if (active) patch({ error: `Could not load ${formatDate(day)}: ${errorText(reason)}` });
    });
    return () => {
      active = false;
    };
  }, [data?.days, day, screen, folderMembershipKey, patch, setDetail]);

  const appRange = useMemo(
    () => data && entity ? appScreenRange(data, span, entity) : { start: "", end: "" },
    [data?.days, data?.folders, span, entity],
  );
  const selectedFolder = entity?.startsWith("f:")
    ? data?.folders.find((folder) => `f:${folder.id}` === entity)
    : undefined;
  const appSegmentsKey = entity && appRange.start && appRange.end
    ? `${entity}\u0000${appRange.start}\u0000${appRange.end}\u0000${dataRevision.current}\u0000${selectedFolder?.items.join("\u0001") ?? ""}`
    : "";
  const currentAppSegments = loadedAppSegments?.key === appSegmentsKey
    ? loadedAppSegments.segments
    : null;

  useEffect(() => {
    if (!data || screen !== "app" || !entity || !appSegmentsKey) return;
    if (currentAppSegments) return;
    let active = true;
    getAppSegments(entity, appRange.start, appRange.end, dataRevision.current).then((segments) => {
      if (active) setLoadedAppSegments({ key: appSegmentsKey, segments });
    }).catch((reason: unknown) => {
      if (active) patch({ error: `Could not load app activity: ${errorText(reason)}` });
    });
    return () => {
      active = false;
    };
  }, [data?.days, entity, screen, appRange.start, appRange.end, appSegmentsKey, currentAppSegments, patch]);

  const dates = useMemo(
    () => data ? dateRange(data, span) : [],
    [data?.days, span],
  );
  const needsHeatmapSegments =
    screen === "overview" && view === "heatmap" && dates.length > 0 && dates.length <= 60;
  const cachedOverview = useMemo(() => {
    if (
      !data ||
      !cachedHeatmap ||
      cachedHeatmap.sourceDays !== data.days ||
      !dates.length ||
      dates[0] < cachedHeatmap.start ||
      dates[dates.length - 1] > cachedHeatmap.end
    ) {
      return null;
    }
    const visibleDates = new Set(dates);
    return {
      days: cachedHeatmap.overview.days.filter((item) => visibleDates.has(item.date)),
      segments: cachedHeatmap.overview.segments.filter((segment) => visibleDates.has(segment.day)),
    };
  }, [data?.days, cachedHeatmap, dates]);
  const overview = useMemo(() => {
    if (!data) return null;
    const offPeriods = new Map(cachedOverview?.days.map((item) => [item.date, item.off_periods]));
    return {
      days: dates.map((date) => ({ date, off_periods: offPeriods.get(date) ?? [] })),
      segments: cachedOverview?.segments ?? [],
    };
  }, [data, dates, cachedOverview]);
  const heatmapLoading = needsHeatmapSegments && !cachedOverview;
  useEffect(() => {
    if (!data || !needsHeatmapSegments || cachedOverview || !dates.length) return;
    let active = true;
    const start = dates[0];
    const end = dates[dates.length - 1];
    getOverview(span, dataRevision.current, folderMembershipKey).then((result) => {
      if (active) {
        setCachedHeatmap({ sourceDays: data.days, start, end, overview: result });
      }
    }).catch((reason: unknown) => {
      if (active) patch({ error: `Could not prepare the selected time span: ${errorText(reason)}` });
    });
    return () => {
      active = false;
    };
  }, [data?.days, span, needsHeatmapSegments, cachedOverview, dates, folderMembershipKey, patch]);

  const statsKey = useMemo(
    () => data
      ? JSON.stringify([
        data.apps.map(({ exe, name, first_seen }) => [exe, name, first_seen]),
        data.folders.map(({ id, name, items }) => [id, name, items]),
      ])
      : "",
    [data?.apps, data?.folders],
  );
  const stats = useMemo(
    () => data ? getStats(data, span, screen === "day" ? day : null) : new Map(),
    [data?.days, statsKey, span, screen, day],
  );
  const dailyAggregates = useMemo(
    () => data
      ? visibleDailyAggregates(data, dates)
      : new Map(),
    [data, dates],
  );
  const activeSegments = useMemo(
    () => data && overview && needsHeatmapSegments && !heatmapLoading
      ? visibleSegments(data, overview.segments)
      : [],
    [data, overview, needsHeatmapSegments, heatmapLoading],
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

  const openDay = useCallback((date: string) => {
    patch({ screen: "day", day: date, error: null });
    setTimelineZoom(1);
    setDetail(null);
  }, [patch, setDetail]);
  const openEntity = useCallback((key: string) => {
    patch({ screen: "app", entity: key, error: null });
  }, [patch]);
  const backToOverview = useCallback(
    () => patch({ screen: "overview", day: null, entity: null }),
    [patch],
  );
  const changeSpan = useCallback((nextSpan: number) => {
    patch({ span: nextSpan });
  }, [patch]);
  const changeVisibility = useCallback(async (app: AppDto, show: boolean) => {
    const current = useUi.getState().data;
    if (!current) return;
    const next = { ...current, apps: current.apps.map((item) => item.exe === app.exe ? { ...item, show } : item) };
    setData(next);
    try {
      await setAppVisibility(app.exe, show);
    } catch (reason) {
      setError(reason, "Could not save app visibility");
    }
  }, [patch, setData]);
  const changeFolders = useCallback(async (folders: FolderDto[], nextId: number) => {
    const current = useUi.getState().data;
    if (!current) return;
    const previousById = new Map(current.folders.map((folder) => [folder.id, folder]));
    const membershipChanged =
      current.folders.length !== folders.length ||
      folders.some((folder) => previousById.get(folder.id)?.items.join("\u0000") !== folder.items.join("\u0000"));
    if (!membershipChanged) setData({ ...current, folders });
    try {
      await saveFolders(folders, nextId);
      if (membershipChanged) setData(await getState());
    } catch (reason) {
      let message = `Could not save folders: ${errorText(reason)}`;
      try {
        setData(await getState());
      } catch (reloadReason) {
        message += `; could not reload folders: ${errorText(reloadReason)}`;
      }
      patch({ error: message });
    }
  }, [patch, setData]);
  const changeAppsVisibility = useCallback(async (exes: string[], show: boolean) => {
    const current = useUi.getState().data;
    if (!current || !exes.length) return;
    const selected = new Set(exes);
    setData({
      ...current,
      apps: current.apps.map((app) => selected.has(app.exe) ? { ...app, show } : app),
    });
    try {
      await setAppsVisibility(exes, show);
    } catch (reason) {
      setError(reason, "Could not save app visibility");
      try {
        setData(await getState());
      } catch (reloadReason) {
        setError(reloadReason, "Could not reload app visibility");
      }
    }
  }, [patch, setData]);
  const changeSort = useCallback((value: SortKey) => patch({ sort: value }), [patch]);
  const changeDirection = useCallback(() => patch({ descending: !useUi.getState().descending }), [patch]);
  const changeSearch = useCallback((value: string) => patch({ search: value }), [patch]);
  const changeView = useCallback((value: "heatmap" | "histogram" | "donut") => patch({ view: value }), [patch]);
  const changeCountUnusedDays = useCallback(
    (value: boolean) => patch({ countUnusedDays: value }),
    [patch],
  );

  const changeDraggedApp = (app: string, target: FolderDropTarget | null) => {
    if (!data) return;
    const result = moveApp(data.folders, app, target);
    if (!result) return;
    if (result.createdFolderId !== undefined) setFolderToRename(result.createdFolderId);
    void changeFolders(result.folders, result.nextId);
  };

  const folderRenameConsumed = useCallback(() => setFolderToRename(null), []);

  const targetAtPoint = (x: number, y: number): FolderDropTarget | null => {
    const element = document.elementFromPoint(x, y);
    const appRow = element?.closest<HTMLElement>("[data-app]");
    if (appRow?.dataset.app) return { app: appRow.dataset.app };
    const folderRow = element?.closest<HTMLElement>("[data-folder]");
    const folderId = Number(folderRow?.dataset.folder);
    return Number.isInteger(folderId) && folderId > 0 ? { folder: folderId } : null;
  };

  const startPointerDrag = (event: React.PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, select, textarea")) return;
    const row = target.closest<HTMLElement>("[data-app]");
    const app = row?.dataset.app;
    if (!row || !app) return;
    pointerDrag.current = {
      pointerId: event.pointerId,
      app,
      startX: event.clientX,
      startY: event.clientY,
      element: row,
      active: false,
      cancelled: false,
    };
  };

  const movePointerDrag = (event: React.PointerEvent) => {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.cancelled) return;
    if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 6) {
      drag.active = true;
      drag.element.setPointerCapture(drag.pointerId);
      document.getSelection()?.removeAllRanges();
      setDraggedApp(drag.app);
    }
    if (!drag.active) return;
    event.preventDefault();
    const target = targetAtPoint(event.clientX, event.clientY);
    const visibleTarget = target && !("app" in target && target.app === drag.app) ? target : null;
    setDropTarget((previous) => {
      if (!previous || !visibleTarget) return visibleTarget;
      if ("app" in previous && "app" in visibleTarget && previous.app === visibleTarget.app) return previous;
      if ("folder" in previous && "folder" in visibleTarget && previous.folder === visibleTarget.folder) return previous;
      return visibleTarget;
    });
  };

  const finishPointerDrag = (event: React.PointerEvent) => {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    pointerDrag.current = null;
    if (drag.cancelled) {
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
    }
    if (drag.active && !drag.cancelled) {
      event.preventDefault();
      if (event.clientX >= 0 && event.clientY >= 0 &&
        event.clientX < window.innerWidth && event.clientY < window.innerHeight) {
        changeDraggedApp(drag.app, targetAtPoint(event.clientX, event.clientY));
      }
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
    }
    setDraggedApp(null);
    setDropTarget(null);
  };

  const cancelPointerDragOnEscape = useCallback((event: KeyboardEvent) => {
    const drag = pointerDrag.current;
    if (event.key !== "Escape" || !drag?.active) return;
    event.preventDefault();
    drag.cancelled = true;
    drag.active = false;
    setDraggedApp(null);
    setDropTarget(null);
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", cancelPointerDragOnEscape);
    return () => window.removeEventListener("keydown", cancelPointerDragOnEscape);
  }, [cancelPointerDragOnEscape]);

  const cancelPointerDrag = () => {
    pointerDrag.current = null;
    setDraggedApp(null);
    setDropTarget(null);
  };

  const onClickCapture = (event: React.MouseEvent) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const onPointerMove = (event: React.PointerEvent) => {
    movePointerDrag(event);
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
      onPointerDownCapture={startPointerDrag}
      onPointerUp={finishPointerDrag}
      onPointerCancel={cancelPointerDrag}
      onClickCapture={onClickCapture}
      onDragOver={(event) => {
        if (event.dataTransfer.files.length) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        void importDroppedFiles(event.dataTransfer.files);
      }}
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
            onSpan={changeSpan}
            onSort={changeSort}
            onDirection={changeDirection}
            onSearch={changeSearch}
            onAppVisibility={changeVisibility}
            onAppsVisibility={changeAppsVisibility}
            onFolders={changeFolders}
            onOpenDay={openDay}
            onOpenEntity={openEntity}
            draggedApp={draggedApp}
            dropTarget={dropTarget}
            folderToRenameId={folderToRename}
            onFolderRenameConsumed={folderRenameConsumed}
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
              segments={currentAppSegments?.segments ?? []}
              rawSegments={entity.startsWith("f:")
                ? currentAppSegments?.raw_segments ?? []
                : currentAppSegments?.segments ?? []}
              loading={!currentAppSegments}
              span={span}
              countUnusedDays={countUnusedDays}
              onCountUnusedDays={changeCountUnusedDays}
              onBack={backToOverview}
              onDay={openDay}
            />
          ) : overview ? (
            <OverviewScreen
              data={data}
              dates={dates}
              overview={overview}
              dailyAggregates={dailyAggregates}
              segments={activeSegments}
              heatmapLoading={heatmapLoading}
              onView={changeView}
              onEntity={openEntity}
              onDay={openDay}
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

const OverviewScreen = memo(function OverviewScreen({
  data,
  dates,
  overview,
  dailyAggregates,
  segments,
  heatmapLoading,
  onView,
  onEntity,
  onDay,
}: {
  data: ClientStateDto;
  dates: string[];
  overview: OverviewDto;
  dailyAggregates: Map<string, Map<string, AppDayAggregate>>;
  segments: FocusSegment[];
  heatmapLoading: boolean;
  onView: (view: "heatmap" | "histogram" | "donut") => void;
  onEntity: (entity: string) => void;
  onDay: (day: string) => void;
}) {
  const view = useUi((state) => state.view);
  const totalsByDay = new Map<string, number>();
  const totalsByEntity = new Map<string, number>();
  let focusSwitches = 0;
  dailyAggregates.forEach((entities, date) => {
    let dayTotal = 0;
    entities.forEach((aggregate, entity) => {
      dayTotal += aggregate.seconds;
      focusSwitches += aggregate.focus_count;
      totalsByEntity.set(entity, (totalsByEntity.get(entity) ?? 0) + aggregate.seconds);
    });
    if (dayTotal > 0) totalsByDay.set(date, dayTotal);
  });
  const total = [...totalsByEntity.values()].reduce((sum, value) => sum + value, 0);
  const mostActive = [...totalsByDay].sort((a, b) => b[1] - a[1])[0];
  const folderItems = new Set(
    data.folders.filter((folder) => folder.on).flatMap((folder) => folder.items),
  );
  const hidden = data.apps.filter((app) => {
    return !app.show && !folderItems.has(app.exe);
  }).length;
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
          <b>{focusSwitches}</b>
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
        {heatmapLoading ? (
          <div className={styles.muted}>Loading heatmap…</div>
        ) : (
          <OverviewChart
            data={data}
            overview={overview}
            dailyAggregates={dailyAggregates}
            segments={segments}
            onEntity={onEntity}
            onDay={onDay}
          />
        )}
      </section>
    </>
  );
});

const DayScreen = memo(function DayScreen({
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
});

function entityName(data: ClientStateDto, entity: string) {
  return data.apps.find((app) => app.exe === entity)?.name ??
    data.folders.find((folder) => `f:${folder.id}` === entity)?.name ?? entity;
}

function formatClockString(seconds: number) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}`;
}
