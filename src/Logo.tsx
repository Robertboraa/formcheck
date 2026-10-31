// FormCheck mark: a joint with two limbs and the angle measured between them,
// on a plate-blue square
function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="4" fill="#1e4fa8" />
      <path d="M17.5 23 A9.5 9.5 0 0 0 14.2 15.9" fill="none" stroke="#f5c518" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M8 23 L25 23 M8 23 L18 9" fill="none" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="8" cy="23" r="2.8" fill="#f5c518" />
    </svg>
  )
}

export default Logo
