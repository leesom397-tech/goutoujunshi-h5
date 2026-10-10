export function BrandMark({ className = "" }: { className?: string }) {
  return <svg className={`cz-brand-mark ${className}`} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M7 10.5 15.7 16 25 8.5M15.7 16 25 24M15.7 16 7 22" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="16" cy="16" r="4.2" fill="currentColor" />
    <circle cx="7" cy="10.5" r="3" fill="#FFC42E" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="25" cy="8.5" r="3" fill="#FFC9D6" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="25" cy="24" r="3" fill="#C6E3FA" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="7" cy="22" r="3" fill="#C6EAD1" stroke="currentColor" strokeWidth="1.5" />
  </svg>;
}
