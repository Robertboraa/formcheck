// FormCheck mark: a joint with two limbs and the angle measured between them
function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#16191e" />
      {/* the angle arc */}
      <path d="M17.5 23 A9.5 9.5 0 0 0 14.2 15.9" fill="none" stroke="#19e3c9" strokeWidth="2.2" strokeLinecap="round" opacity="0.55" />
      {/* the two limbs */}
      <path d="M8 23 L25 23 M8 23 L18 9" fill="none" stroke="#19e3c9" strokeWidth="2.6" strokeLinecap="round" />
      {/* joints */}
      <circle cx="8" cy="23" r="2.6" fill="#eef1f4" />
      <circle cx="25" cy="23" r="2" fill="#eef1f4" />
      <circle cx="18" cy="9" r="2" fill="#eef1f4" />
    </svg>
  )
}

export default Logo
