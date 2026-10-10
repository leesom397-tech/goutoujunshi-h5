export function BrandMark({ className = "" }: { className?: string }) {
  return <svg className={`cz-brand-mark ${className}`} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <circle cx="16" cy="16" r="5.2" fill="currentColor" />
    <path d="M4.5 16c2.4-5.1 6.6-8 11.5-8s9.1 2.9 11.5 8c-2.4 5.1-6.6 8-11.5 8S6.9 21.1 4.5 16Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="7" cy="12" r="1.7" fill="#FF9DB5" />
    <circle cx="25" cy="20" r="1.7" fill="#72BCEB" />
  </svg>;
}
