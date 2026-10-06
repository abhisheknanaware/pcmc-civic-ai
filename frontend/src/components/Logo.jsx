// Brand mark: "ward mosaic". Four tiles stand for the city's zones; the marigold tile is ticked
// ("every ward, one desk, issue resolved"). Matches public/favicon.svg.
export function LogoMark({ size = 34, className = '' }) {
  return (
    <svg className={`logo-mark ${className}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect className="logo-tile t1" x="4" y="4" width="26" height="26" rx="8" fill="#0f5e57" />
      <rect className="logo-tile t2" x="34" y="4" width="26" height="26" rx="8" fill="#127a6f" />
      <rect className="logo-tile t3" x="4" y="34" width="26" height="26" rx="8" fill="#127a6f" />
      <rect className="logo-tile t4" x="34" y="34" width="26" height="26" rx="8" fill="#e8891c" />
      <path className="logo-check" d="m40.5 47 4.5 4.5 8.5-9" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Wordmark: "PCMC" set heavy, "Civic" lighter in the brand teal.
export default function Logo({ size = 34 }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span className="logo-word"><strong>PCMC</strong><span>Civic</span></span>
    </span>
  );
}
