"use client";

import { GlassStudy } from "./GlassStudy";
import styles from "./BrandField.module.css";

/** The original homepage material, reused without another remote image request. */
export function BrandField({ variant = "ambient", paused = false }: { variant?: "hero" | "ambient" | "waiting"; paused?: boolean }) {
  return <div className={styles.field} data-brand-field={variant} data-paused={paused||undefined} aria-hidden={variant==="hero"?undefined:true}>
    {paused ? <img className={styles.still} src="/images/aurora-fluted-light-v5.webp" alt=""/> : <GlassStudy variant={variant === "hero" ? "home" : "report"}/>}
    <div className={styles.frost}/>
    {variant === "waiting" && !paused && <div className={styles.flow}><i/><i/><i/></div>}
  </div>;
}
