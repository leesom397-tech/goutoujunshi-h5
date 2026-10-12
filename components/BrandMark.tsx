export function BrandMark({ className = "" }: { className?: string }) {
  return <img className={`cz-brand-mark ${className}`} src="/brand-mark.svg?v=aurora-1" width={32} height={32} alt="" aria-hidden="true" draggable={false}/>;
}
