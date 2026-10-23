import { PageIllustration } from "@/components/PageIllustration";
import styles from "@/app/archive/archive.module.css";

/** A relationship map, not fabricated people, measurements or profile data. */
export function RelationshipIllustration({ self = false }: { self?: boolean }) {
  return <div className="cz-archive-illustration" aria-hidden="true"><PageIllustration variant={self ? "self" : "archive"}/></div>;
}

export function ArchiveEmptyIllustration() {
  return <div className="cz-archive-empty" aria-hidden="true"><PageIllustration variant="archive" compact/></div>;
}

export function NumberedHeading({ number, title, caption }: { number: string; title: string; caption?: string }) {
  return <div className={styles.numberedHeading}><span>{number}</span><div><h2>{title}</h2>{caption && <p>{caption}</p>}</div></div>;
}
