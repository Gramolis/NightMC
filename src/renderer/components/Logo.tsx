/**
 * Logo NightMC - oryginalny znak: półksiężyc obejmujący geometryczną literę "N".
 * Nie zawiera i nie naśladuje żadnego elementu marki Minecraft.
 */

interface LogoProps {
  size?: number;
  glow?: boolean;
}

export function Logo({ size = 34, glow = true }: LogoProps) {
  const id = `nm${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-label="NightMC">
      <defs>
        <linearGradient id={`${id}-moon`} x1="10" y1="6" x2="54" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#B9A7FF" />
          <stop offset="0.55" stopColor="#7A5CFF" />
          <stop offset="1" stopColor="#3FD0E8" />
        </linearGradient>
        <linearGradient id={`${id}-n`} x1="22" y1="18" x2="44" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#EDE8FF" />
          <stop offset="1" stopColor="#9FE9F6" />
        </linearGradient>
        {glow && (
          <filter id={`${id}-glow`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>

      <g filter={glow ? `url(#${id}-glow)` : undefined}>
        {/* Półksiężyc: pełne koło minus przesunięte koło. */}
        <path
          d="M32 3.5C16.26 3.5 3.5 16.26 3.5 32S16.26 60.5 32 60.5c4.6 0 8.95-1.09 12.8-3.03
             C34.1 54.6 26.2 44.4 26.2 32.3S34.1 10 44.8 6.53A28.4 28.4 0 0 0 32 3.5Z"
          fill={`url(#${id}-moon)`}
        />
        {/* Geometryczne "N" wpisane w łuk księżyca. */}
        <path
          d="M35.5 45.5V21.5l14 18V21.5"
          stroke={`url(#${id}-n)`}
          strokeWidth="4.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {/* Gwiazdki towarzyszące. */}
        <circle cx="52.5" cy="12.5" r="1.9" fill="#EDE8FF" />
        <circle cx="58" cy="24" r="1.15" fill="#9FE9F6" />
        <circle cx="47" cy="55" r="1.1" fill="#B9A7FF" />
      </g>
    </svg>
  );
}
