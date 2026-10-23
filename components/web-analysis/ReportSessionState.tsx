"use client";
import { createContext, useContext, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { cachedReport } from '@/lib/report-session-cache';

export const ReportSessionContext = createContext<{ owner: string; id: string } | null>(null);
/** Only display selections/drafts opt in; paid requests and dialogs never replay. */
export function useReportSessionState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const scope = useContext(ReportSessionContext);
  const [value, setValue] = useState<T>(() => {
    const entry = scope && cachedReport(scope.owner, scope.id);
    return entry?.ui.has(key) ? entry.ui.get(key) as T : typeof initial === 'function' ? (initial as () => T)() : initial;
  });
  const latest = useRef(value); latest.current = value;
  const update: Dispatch<SetStateAction<T>> = next => {
    const result = typeof next === 'function' ? (next as (previous: T) => T)(latest.current) : next;
    latest.current = result;
    const entry = scope && cachedReport(scope.owner, scope.id);
    if (entry && (entry.ui.has(key) || entry.ui.size < 80)) {
      try { if(JSON.stringify(result).length<=50_000)entry.ui.set(key, result); } catch { /* Keep oversized/nonserializable display state local. */ }
    }
    setValue(result);
  };
  return [value, update];
}
