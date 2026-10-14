"use client";
import { useEffect, useRef, useState } from "react";
import { clearIntakeDraftOwner, deleteIntakeDraft, draftKey, readIntakeDraft, saveIntakeDraft, type IntakeDraft } from "./intake-drafts";
type Snapshot = Omit<IntakeDraft, "updatedAt" | "expiresAt" | "bytes">;
export function useIntakeDraft(snapshot: Snapshot, ready: boolean, locked: boolean, hasResult: boolean) {
  const [available, setAvailable] = useState<IntakeDraft | null>(null), [state, setState] = useState("");
  const previousOwner = useRef(snapshot.owner), current = useRef(snapshot), active = useRef({ ready, locked, hasResult }), lastSaved = useRef("");
  current.current = snapshot; active.current = { ready, locked, hasResult };
  const key = draftKey(snapshot);
  useEffect(() => {
    if (previousOwner.current && previousOwner.current !== snapshot.owner) void clearIntakeDraftOwner(previousOwner.current).catch(() => {});
    previousOwner.current = snapshot.owner; setAvailable(null); setState(""); lastSaved.current = "";
  }, [snapshot.owner]);
  useEffect(() => {
    let alive = true; setAvailable(null);
    if (!snapshot.owner || !ready || locked || hasResult || snapshot.files.length || lastSaved.current === key) return;
    void readIntakeDraft(snapshot).then(value => { if (alive && draftKey(current.current) === key && !current.current.files.length && !active.current.locked && !active.current.hasResult) setAvailable(value); }).catch(() => {});
    return () => { alive = false; };
  }, [key, ready, locked, hasResult, snapshot.files.length]);
  useEffect(() => {
    if (!snapshot.owner || !ready || locked || hasResult) return;
    if (!snapshot.files.length) { if (lastSaved.current === key) { lastSaved.current = ""; void deleteIntakeDraft(snapshot).catch(() => {}); setState(""); } return; }
    let alive = true; setAvailable(null);
    void saveIntakeDraft(snapshot).then(saved => { if (alive && draftKey(current.current) === key) { if (saved) lastSaved.current = key; setState(saved ? "已暂存本机 · 24 小时内可恢复" : "本批材料未暂存，仍可正常提交分析。"); } }).catch(() => { if (alive) setState("浏览器未能暂存材料，仍可正常提交分析。"); });
    return () => { alive = false; };
  }, [key, ready, locked, hasResult, snapshot.files, snapshot.selfSide, snapshot.sameCity, snapshot.compare, snapshot.returnTo, snapshot.previous, snapshot.previousCount, snapshot.captureSource]);
  async function discard() { setAvailable(null); setState(""); lastSaved.current = ""; await deleteIntakeDraft(current.current).catch(() => {}); }
  return { available, state, discard, dismiss: () => setAvailable(null) };
}
