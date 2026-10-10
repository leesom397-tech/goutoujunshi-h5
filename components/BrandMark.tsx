import { Orbit } from "lucide-react";

export function BrandMark({ className = "" }: { className?: string }) {
  return <Orbit className={`cz-brand-mark ${className}`} size={26} strokeWidth={1.6} aria-hidden="true" />;
}
