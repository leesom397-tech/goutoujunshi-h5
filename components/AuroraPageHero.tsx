import type { ReactNode } from "react";
import styles from "./AuroraUI.module.css";

export function AuroraPageHero({ eyebrow, title, description, children }: { eyebrow: string; title: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return <header className={styles.hero} data-aurora-hero>
    <div className={styles.heroCopy}>
      <span className={styles.eyebrow}>{eyebrow}</span>
      <h1 className={styles.title}>{title}</h1>
      {description && <div className={styles.description}>{description}</div>}
      {children && <div className={styles.actions}>{children}</div>}
    </div>
  </header>;
}
