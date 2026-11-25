import { useMemo, useRef, useState } from "react";
import type { AppDto, ClientStateDto, FolderDto } from "../api/types";
import type { AppStats } from "../lib";
import { formatDate, formatDuration, sortValue } from "../lib";
import type { Screen, SortKey } from "../state";
import styles from "../App.module.css";

type Props = {
  data: ClientStateDto;
  stats: Map<string, AppStats>;
  screen: Screen;
  day: string | null;
  entity: string | null;
  span: number;
  sort: SortKey;
  descending: boolean;
  search: string;
  onSpan: (span: number) => void;
  onSort: (sort: SortKey) => void;
  onDirection: () => void;
  onSearch: (value: string) => void;
  onAppVisibility: (app: AppDto, show: boolean) => void;
  onFolders: (folders: FolderDto[], nextId: number) => void;
  onOpenDay: (day: string) => void;
  onOpenEntity: (key: string) => void;
};

const nextFolderColor = (id: number) => `hsl(${Math.round(id * 137.508) % 360} 65% 50%)`;
const sortLabels: Record<SortKey, string> = {
  seconds: "By time",
  first: "By first seen",
  max: "Max per day",
  average: "Average per day",
  launches: "By launches",
  name: "By name",
};

export function Sidebar(props: Props) {
  const {
    data, stats, screen, day, entity, span, sort, descending, search,
    onSpan, onSort, onDirection, onSearch, onAppVisibility, onFolders,
    onOpenDay, onOpenEntity,
  } = props;
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const clickTimer = useRef<number | undefined>(undefined);
  const query = search.trim().toLowerCase();
  const first = data.days[0]?.date;
  const last = data.days[data.days.length - 1]?.date;
  const folderByItem = useMemo(() => {
    const map = new Map<string, FolderDto>();
    data.folders.forEach((folder) => folder.items.forEach((item) => map.set(item, folder)));
    return map;
  }, [data.folders]);

  const matchesApp = (app: AppDto) =>
    !query || app.name.toLowerCase().includes(query) || app.exe.includes(query);
  const compare = (left: AppStats, right: AppStats) => {
    const a = sortValue(left, sort);
    const b = sortValue(right, sort);
    const result = typeof a === "string" && typeof b === "string"
      ? a.localeCompare(b)
      : Number(a) - Number(b);
    return (descending ? -1 : 1) * result;
  };
  const apps = data.apps.filter(matchesApp).sort((a, b) => {
    const left = stats.get(a.exe);
    const right = stats.get(b.exe);
    return left && right ? compare(left, right) : 0;
  });
  const visibleFolders = data.folders.filter((folder) =>
    stats.has(`f:${folder.id}`) &&
    (!query || folder.name.toLowerCase().includes(query) || folder.items.some((item) => {
      const app = data.apps.find((candidate) => candidate.exe === item);
      return app ? matchesApp(app) : false;
    })),
  );
  const appCount = data.apps.filter((app) => stats.has(app.exe)).length;

  const saveFolders = (next: FolderDto[], nextId?: number) => {
    onFolders(next.filter((folder) => folder.items.length > 0), nextId ?? Math.max(1, ...next.map((folder) => folder.id + 1)));
  };
  const listedFolderItems = (folder: FolderDto) => {
    const nameMatches = folder.name.toLowerCase().includes(query);
    return folder.items
      .map((key) => data.apps.find((app) => app.exe === key))
      .filter((app): app is AppDto => !!app && stats.has(app.exe) && (!query || nameMatches || matchesApp(app)))
      .sort((a, b) => {
        const left = stats.get(a.exe);
        const right = stats.get(b.exe);
        return left && right ? compare(left, right) : 0;
      });
  };

  const toggleFolder = (folder: FolderDto) => {
    saveFolders(data.folders.map((item) => item.id === folder.id ? { ...item, on: !item.on } : item));
  };
  const openFolder = (folder: FolderDto) => {
    window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => onOpenEntity(`f:${folder.id}`), 250);
  };
  const startRename = (folder: FolderDto) => {
    window.clearTimeout(clickTimer.current);
    setRenameId(folder.id);
    setRenameValue(folder.name);
  };
  const commitRename = () => {
    if (renameId === null) return;
    const value = renameValue.trim();
    if (value) saveFolders(data.folders.map((folder) =>
      folder.id === renameId ? { ...folder, name: value } : folder,
    ));
    setRenameId(null);
  };

  const handleDrop = (event: React.DragEvent, target?: { app?: string; folder?: FolderDto }) => {
    const dragged = event.dataTransfer.getData("text/plain");
    if (!dragged) return;
    event.preventDefault();
    const sourceFolder = folderByItem.get(dragged);
    const removeDragged = (folders: FolderDto[]) =>
      folders.map((folder) => ({ ...folder, items: folder.items.filter((item) => item !== dragged) }));
    let folders = removeDragged(data.folders);
    if (target?.folder) {
      if (target.folder.items.includes(dragged)) return;
      folders = folders.map((folder) => folder.id === target.folder?.id
        ? { ...folder, items: [...folder.items, dragged] }
        : folder);
      saveFolders(folders);
      return;
    }
    if (target?.app) {
      if (target.app === dragged) return;
      const targetFolder = folderByItem.get(target.app);
      if (sourceFolder && sourceFolder.id === targetFolder?.id) return;
      if (targetFolder) {
        folders = folders.map((folder) => folder.id === targetFolder.id
          ? { ...folder, items: [...folder.items, dragged] }
          : folder);
        saveFolders(folders);
      } else {
        const id = Math.max(1, ...folders.map((folder) => folder.id + 1));
        folders.push({
          id,
          name: `Folder ${id}`,
          on: true,
          open: true,
          items: [target.app, dragged],
          color: nextFolderColor(id),
        });
        setRenameId(id);
        setRenameValue(`Folder ${id}`);
        saveFolders(folders, id + 1);
      }
      return;
    }
    if (sourceFolder) saveFolders(folders);
  };

  const appRow = (app: AppDto, nested = false, activeFolder?: FolderDto) => {
    const value = stats.get(app.exe);
    if (!value) return null;
    const memberDim = activeFolder?.on;
    const selected = screen === "app" && entity === app.exe;
    return (
      <div
        key={app.exe}
        className={`${styles.listRow} ${selected ? styles.selected : ""}`}
        style={nested ? { paddingLeft: 26 } : undefined}
        draggable
        data-app={app.exe}
        onDragStart={(event) => {
          event.dataTransfer.setData("text/plain", app.exe);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => handleDrop(event, { app: app.exe })}
      >
        {screen !== "app" && (
          <input
            type="checkbox"
            checked={memberDim ? true : app.show}
            disabled={memberDim}
            title="Include in stats"
            onChange={(event) => onAppVisibility(app, event.target.checked)}
          />
        )}
        <span className={styles.dot} style={{ background: app.color }} />
        <button type="button" className={styles.nameButton} title={app.exe} onClick={() => onOpenEntity(app.exe)}>
          {app.name}
        </button>
        <span className={styles.value}>{formatSortValue(value, sort)}</span>
      </div>
    );
  };

  const folderRow = (folder: FolderDto) => {
    const value = stats.get(`f:${folder.id}`);
    if (!value) return null;
    const selected = screen === "app" && entity === `f:${folder.id}`;
    const autoExpand = Boolean(query && (
      folder.name.toLowerCase().includes(query) ||
      folder.items.some((item) => data.apps.some((app) => app.exe === item && matchesApp(app)))
    ));
    return (
      <div key={folder.id}>
        <div
          className={`${styles.listRow} ${styles.folderRow} ${selected ? styles.selected : ""}`}
          data-folder={folder.id}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => handleDrop(event, { folder })}
        >
          {screen !== "app" && (
            <input
              type="checkbox"
              checked={folder.on}
              title="Merge into one entry and include in stats"
              onChange={() => toggleFolder(folder)}
            />
          )}
          <span className={styles.folderIcon} style={{ color: folder.color }}>▰</span>
          {renameId === folder.id ? (
            <input
              className={styles.renameInput}
              value={renameValue}
              autoFocus
              onChange={(event) => setRenameValue(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") setRenameId(null);
              }}
            />
          ) : (
            <button
              type="button"
              className={styles.nameButton}
              title="Double-click to rename"
              onClick={() => openFolder(folder)}
              onDoubleClick={() => startRename(folder)}
            >
              {folder.name}
            </button>
          )}
          <span className={styles.value}>{formatSortValue(value, sort)}</span>
          <button
            type="button"
            className={styles.chevron}
            aria-label={folder.open || autoExpand ? "Collapse folder" : "Expand folder"}
            onClick={() => saveFolders(data.folders.map((item) =>
              item.id === folder.id ? { ...item, open: !(item.open || autoExpand) } : item,
            ))}
          >
            {folder.open || autoExpand ? "▾" : "▸"}
          </button>
        </div>
        {(folder.open || autoExpand) && listedFolderItems(folder).map((app) => appRow(app, true, folder))}
      </div>
    );
  };

  const selectApps = () => {
    const listed = apps.filter((app) => !(folderByItem.get(app.exe)?.on));
    const allSelected = listed.every((app) => app.show);
    listed.forEach((app) => onAppVisibility(app, !allSelected));
  };
  const selectFolders = () => {
    const allEnabled = visibleFolders.every((folder) => folder.on);
    saveFolders(data.folders.map((folder) =>
      visibleFolders.some((visible) => visible.id === folder.id)
        ? { ...folder, on: !allEnabled }
        : folder,
    ));
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.rangeControls}>
        {screen === "day" ? (
          <>
            <button
              type="button"
              onClick={() => navigateDay(data, day, -1, onOpenDay)}
            >
              ◀
            </button>
            <strong>{day ? `${formatDate(day)}, ${new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}` : ""}</strong>
            <button
              type="button"
              onClick={() => navigateDay(data, day, 1, onOpenDay)}
            >
              ▶
            </button>
          </>
        ) : (
          <>
            <select value={span} aria-label="Time span" onChange={(event) => onSpan(Number(event.target.value))}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={180}>Last 180 days</option>
              <option value={365}>Last 365 days</option>
              <option value={0}>All time</option>
            </select>
            <span className={styles.muted}>{first && last ? `${formatDate(span === 0 ? first : dateBefore(last, span - 1))} – ${formatDate(last)}` : ""}</span>
          </>
        )}
      </div>
      <input
        type="search"
        placeholder="Search apps"
        aria-label="Search apps"
        value={search}
        onChange={(event) => onSearch(event.target.value)}
      />
      <div className={styles.sortControls}>
        <select value={sort} aria-label="Sort apps" onChange={(event) => onSort(event.target.value as SortKey)}>
          {(Object.keys(sortLabels) as SortKey[]).map((key) => <option key={key} value={key}>{sortLabels[key]}</option>)}
        </select>
        <button type="button" title="Direction" onClick={onDirection}>{descending ? "↓" : "↑"}</button>
      </div>
      {screen !== "app" && (
        <div className={styles.selectButtons}>
          <button type="button" title="Check or uncheck all apps with an active checkbox" onClick={selectApps}>Select All Apps</button>
          <button type="button" title="Turn all folders on or off" onClick={selectFolders}>Select All ▰</button>
        </div>
      )}
      <div
        className={styles.appList}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => handleDrop(event)}
      >
        {visibleFolders.map(folderRow)}
        {apps
          .filter((app) => !folderByItem.has(app.exe))
          .map((app) => appRow(app))}
        {apps.length === 0 && visibleFolders.length === 0 && <span className={styles.muted}>No apps</span>}
      </div>
      <div className={styles.totalCount}>Total: {appCount} apps</div>
    </aside>
  );
}

function navigateDay(data: ClientStateDto, day: string | null, direction: -1 | 1, onOpenDay: (day: string) => void) {
  if (!day) return;
  const dates = data.days.map((item) => item.date);
  const index = dates.indexOf(day);
  const next = dates[index + direction];
  if (next) onOpenDay(next);
}

function formatSortValue(value: AppStats, sort: SortKey): string {
  if (sort === "first") return formatDate(new Date(value.first * 1000).toISOString().slice(0, 10));
  if (sort === "launches") return `${value.launches} runs`;
  if (sort === "max") return formatDuration(value.max);
  if (sort === "average") return formatDuration(value.average);
  return formatDuration(value.seconds);
}

function dateBefore(date: string, days: number) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() - days);
  return result.toISOString().slice(0, 10);
}
