import type { AppDto, FolderDto } from "./api/types";

export type FolderDropTarget = { app: string } | { folder: number };

export function getAppsVisibilityToggle(apps: AppDto[], folders: FolderDto[]) {
  const folderItems = new Set(folders.flatMap((folder) => folder.items));
  const eligible = apps.filter((app) => !folderItems.has(app.exe));

  return {
    exes: eligible.map((app) => app.exe),
    show: !eligible.every((app) => app.show),
  };
}

export function getFoldersVisibilityToggle(folders: FolderDto[]) {
  const on = !folders.every((folder) => folder.on);
  return folders.map((folder) => ({ ...folder, on }));
}

export function moveApp(
  folders: FolderDto[],
  app: string,
  target: FolderDropTarget | null,
): { folders: FolderDto[]; nextId: number; createdFolderId?: number } | null {
  const source = folders.find((folder) => folder.items.includes(app));
  if (!target && !source) return null;
  if (target && "app" in target && target.app === app) return null;

  const targetFolder = target && "folder" in target
    ? folders.find((folder) => folder.id === target.folder)
    : target && "app" in target
      ? folders.find((folder) => folder.items.includes(target.app))
      : undefined;
  if (source && targetFolder?.id === source.id) return null;

  let next = folders
    .map((folder) => ({ ...folder, items: folder.items.filter((item) => item !== app) }))
    .filter((folder) => folder.items.length > 0);
  let createdFolderId: number | undefined;

  if (target && "folder" in target) {
    if (!targetFolder) return null;
    next = next.map((folder) =>
      folder.id === target.folder ? { ...folder, items: [...folder.items, app] } : folder,
    );
  } else if (target && "app" in target) {
    if (targetFolder) {
      next = next.map((folder) =>
        folder.id === targetFolder.id ? { ...folder, items: [...folder.items, app] } : folder,
      );
    } else {
      const id = Math.max(1, ...next.map((folder) => folder.id + 1));
      createdFolderId = id;
      next.push({
        id,
        name: `Folder ${id}`,
        on: true,
        open: true,
        items: [target.app, app],
        color: `hsl(${Math.round(id * 137.508) % 360} 65% 50%)`,
      });
    }
  }

  return {
    folders: next,
    nextId: Math.max(1, ...next.map((folder) => folder.id + 1)),
    createdFolderId,
  };
}
