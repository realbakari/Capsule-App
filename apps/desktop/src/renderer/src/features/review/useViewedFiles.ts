import { useCallback, useMemo, useState } from "react";
import type { DiffFile } from "@capsule/shared";
import { diffFileHash, readViewedStore, setViewed, viewedKey, writeViewedStore } from "../../lib/viewed-files";

export interface ViewedMarks {
  isViewed: (file: DiffFile) => boolean;
  mark: (file: DiffFile, viewed: boolean) => void;
}

function storage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

const hashes = new WeakMap<DiffFile, string>();
function keyOf(file: DiffFile): string {
  let hash = hashes.get(file);
  if (!hash) { hash = diffFileHash(file); hashes.set(file, hash); }
  return viewedKey(file, hash);
}

export function useViewedFiles(thread: string): ViewedMarks {
  const [store, setStore] = useState(() => readViewedStore(storage()));
  const marks = store[thread];
  const isViewed = useCallback((file: DiffFile) => Boolean(marks?.[keyOf(file)]), [marks]);
  const mark = useCallback((file: DiffFile, viewed: boolean) => {
    // Re-read so a second window's marks are merged rather than overwritten.
    const next = setViewed(readViewedStore(storage()), thread, keyOf(file), viewed);
    writeViewedStore(storage(), next);
    setStore(next);
  }, [thread]);
  return useMemo(() => ({ isViewed, mark }), [isViewed, mark]);
}
