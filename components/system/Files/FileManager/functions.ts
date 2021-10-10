import type { FSModule } from "browserfs/dist/node/core/FS";
import type { Files } from "components/system/Files/FileManager/useFolder";
import type { SortBy } from "components/system/Files/FileManager/useSortBy";
import type { Stats } from "fs";
import { basename, extname, join } from "path";
import { ONE_TIME_PASSIVE_EVENT } from "utils/constants";

export type FileStat = Stats & {
  systemShortcut?: boolean;
};

export type FileStats = [string, FileStat];

type SortFunction = (a: FileStats, b: FileStats) => number;

const sortByName = ([a]: FileStats, [b]: FileStats): number =>
  a.localeCompare(b, "en", { sensitivity: "base" });

const sortBySize = (
  [, { size: aSize }]: FileStats,
  [, { size: bSize }]: FileStats
): number => aSize - bSize;

const sortByType = ([a]: FileStats, [b]: FileStats): number =>
  extname(a).localeCompare(extname(b), "en", { sensitivity: "base" });

const sortByDate = (
  [, { mtimeMs: aTime }]: FileStats,
  [, { mtimeMs: bTime }]: FileStats
): number => aTime - bTime;

const sortSystemShortcuts = (
  [, { systemShortcut: aSystem }]: FileStats,
  [, { systemShortcut: bSystem }]: FileStats
): number => (aSystem === bSystem ? 0 : aSystem ? -1 : 1);

const sortFunctionMap: Record<string, SortFunction> = {
  date: sortByDate,
  name: sortByName,
  size: sortBySize,
  type: sortByType,
};

export const sortContents = (
  contents: Files,
  sortOrder: string[],
  sortFunction?: SortFunction
): Files => {
  if (sortOrder.length > 0) {
    const contentOrder = Object.keys(contents);

    return Object.fromEntries(
      [
        ...sortOrder.filter((entry) => contentOrder.includes(entry)),
        ...contentOrder.filter((entry) => !sortOrder.includes(entry)),
      ].map((entry) => [entry, contents[entry]])
    );
  }

  const files: FileStats[] = [];
  const folders: FileStats[] = [];
  const preSort = sortFunction && sortFunction !== sortByName;

  Object.entries(contents).forEach((entry) => {
    const [, stat] = entry;

    if (!stat.isDirectory()) {
      files.push(entry);
    } else {
      folders.push(entry);
    }
  });

  const sortedContents = [
    ...(preSort
      ? folders.sort(sortByName).sort(sortFunction)
      : folders.sort(sortByName)),
    ...(preSort
      ? files.sort(sortByName).sort(sortFunction)
      : files.sort(sortByName)),
  ].sort(sortSystemShortcuts);

  return Object.fromEntries(sortedContents);
};

export const sortFiles = (files: Files, sortBy: SortBy): Files =>
  sortBy in sortFunctionMap
    ? sortContents(files, [], sortFunctionMap[sortBy])
    : files;

export const iterateFileName = (name: string, iteration: number): string => {
  const extension = extname(name);
  const fileName = basename(name, extension);

  return `${fileName} (${iteration})${extension}`;
};

export const haltEvent = (
  event: Event | React.DragEvent | React.KeyboardEvent | React.MouseEvent
): void => {
  event.preventDefault();
  event.stopPropagation();
};

export const handleFileInputEvent = (
  event: Event | React.DragEvent,
  callback: (fileName: string, buffer?: Buffer) => void
): void => {
  haltEvent(event);

  const eventTarget =
    (event as React.DragEvent)?.dataTransfer ||
    (event.currentTarget as HTMLInputElement);
  const eventFiles = eventTarget?.files || [];

  if (eventFiles.length > 0) {
    [...eventFiles].forEach((file) => {
      const reader = new FileReader();

      reader.addEventListener(
        "load",
        ({ target }) => {
          if (target?.result instanceof ArrayBuffer) {
            callback(file.name, Buffer.from(new Uint8Array(target.result)));
          }
        },
        ONE_TIME_PASSIVE_EVENT
      );
      reader.readAsArrayBuffer(file);
    });
  } else {
    const filePaths = eventTarget?.getData("text").split(",");

    filePaths.forEach((path) => callback(path));
  }
};

export const findPathsRecursive = (
  fs: FSModule | undefined,
  paths: string[]
): Promise<string[]> =>
  new Promise((resolve) =>
    Promise.all(
      paths.map(
        (path): Promise<string[]> =>
          new Promise((pathResolve) =>
            fs?.stat(path, (_statError, stats) => {
              if (stats?.isDirectory()) {
                fs?.readdir(path, (_readError, files = []) =>
                  pathResolve(
                    findPathsRecursive(
                      fs,
                      files.map((file) => join(path, file))
                    )
                  )
                );
              } else {
                pathResolve([path]);
              }
            })
          )
      )
    ).then((newPaths) => resolve(newPaths.flat()))
  );
