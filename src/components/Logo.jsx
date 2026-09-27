export function LogoMark({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#141B3C" />
      <rect x="12" y="20" width="40" height="30" rx="7" fill="#2A3370" />
      <rect x="12" y="24" width="40" height="26" rx="7" fill="#F4F6FB" />
      <path d="M19 42 L27 35 L33 39 L44 29" stroke="#0E9F6E" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="44" cy="29" r="3.5" fill="#0E9F6E" />
    </svg>
  );
}
export function Logo({ small = false }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={small ? 28 : 32} />
      <span className={`font-display font-bold tracking-tight ${small ? 'text-lg' : 'text-xl'}`}>Pera</span>
    </span>
  );
}
