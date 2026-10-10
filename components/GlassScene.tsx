"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import "./glass-scene.css";

export type GlassSceneProps = {
  variant?: "hero" | "analysis";
  className?: string;
  imageClassName?: string;
  imageSrc?: string;
  alt?: string;
  decorative?: boolean;
};

/** A glass image with optional ambient motion and pointer depth. */
export function GlassScene({
  variant = "hero",
  className = "",
  imageClassName = "",
  imageSrc,
  alt,
  decorative = false,
}: GlassSceneProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const finePointerRef = useRef(false);
  // Start still until the browser's motion preference has been checked.
  const [reducedMotion, setReducedMotion] = useState(true);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [userPaused, setUserPaused] = useState(false);
  const running = !reducedMotion && inView && pageVisible && !userPaused;
  const analysis = variant === "analysis";

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const updateMotion = () => setReducedMotion(motion.matches);
    const updatePointer = () => { finePointerRef.current = pointer.matches; };
    const updateVisibility = () => setPageVisible(document.visibilityState === "visible");
    updateMotion();
    updatePointer();
    updateVisibility();
    motion.addEventListener("change", updateMotion);
    pointer.addEventListener("change", updatePointer);
    document.addEventListener("visibilitychange", updateVisibility);

    const element = stageRef.current;
    const observer = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0 })
      : null;
    if (observer && element) observer.observe(element);
    else setInView(true);

    return () => {
      motion.removeEventListener("change", updateMotion);
      pointer.removeEventListener("change", updatePointer);
      document.removeEventListener("visibilitychange", updateVisibility);
      observer?.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const resetPointer = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    const style = stageRef.current?.style;
    style?.setProperty("--cz-glass-x", "0px");
    style?.setProperty("--cz-glass-y", "0px");
    style?.setProperty("--cz-glass-rx", "0deg");
    style?.setProperty("--cz-glass-ry", "0deg");
  }, []);

  useEffect(() => {
    if (!running) resetPointer();
  }, [running, resetPointer]);

  const movePointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!running || !finePointerRef.current || event.pointerType !== "mouse") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
    const y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const style = stageRef.current?.style;
      style?.setProperty("--cz-glass-x", `${x * 6}px`);
      style?.setProperty("--cz-glass-y", `${y * 6}px`);
      style?.setProperty("--cz-glass-rx", `${-y * 2}deg`);
      style?.setProperty("--cz-glass-ry", `${x * 2}deg`);
    });
  };

  return (
    <div
      ref={stageRef}
      className={`cz-glass-stage cz-glass-${variant} ${className}`.trim()}
      data-motion={running ? "running" : "paused"}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      onPointerMove={movePointer}
      onPointerLeave={resetPointer}
      onPointerCancel={resetPointer}
    >
      <div className="cz-glass-parallax">
        <div className="cz-glass-float">
          <img
            className={`cz-glass-image ${imageClassName}`.trim()}
            src={imageSrc ?? (analysis ? "/visuals/conversation-daylight.webp" : "/visuals/relationship-daylight.webp")}
            width={analysis ? 1448 : 1672}
            height={analysis ? 1086 : 941}
            alt={decorative ? "" : (alt ?? (analysis ? "日光下的透明玻璃对话面板与光学镜片" : "日光下交织的透明玻璃对话环"))}
            aria-hidden={decorative ? true : undefined}
            fetchPriority={analysis ? "auto" : "high"}
            decoding="async"
            draggable={false}
          />
          <div className="cz-glass-effects" aria-hidden="true">
            <span className="cz-glass-light" />
            <span className="cz-glass-caustic" />
            <span className="cz-glass-spark cz-glass-spark-one" />
            <span className="cz-glass-spark cz-glass-spark-two" />
          </div>
        </div>
      </div>
      {!reducedMotion && (
        <button
          type="button"
          className="cz-glass-toggle"
          aria-label={userPaused ? "播放视觉动画" : "暂停视觉动画"}
          title={userPaused ? "播放动画" : "暂停动画"}
          onClick={() => setUserPaused(value => !value)}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            {userPaused
              ? <path d="M5 3.5 12 8l-7 4.5v-9Z" fill="currentColor" />
              : <><path d="M5.5 4v8M10.5 4v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>}
          </svg>
        </button>
      )}
    </div>
  );
}
