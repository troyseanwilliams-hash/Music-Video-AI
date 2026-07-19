// Animated aurora-waveform background — pure SVG + CSS, no dependencies.
// Renders slow-drifting gradient waves (an abstract audio waveform) behind
// hero sections. Uses the theme's primary/accent variables so it adapts to
// light and dark mode automatically. Position the parent `relative`;
// this layer is absolutely positioned and pointer-transparent.

export function AuroraBackground({ className = "" }: { className?: string }) {
  return (
    <div
      className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}
      aria-hidden="true"
    >
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 1440 600"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="aurora-a" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0" />
            <stop offset="35%" stopColor="hsl(var(--primary))" stopOpacity="0.35" />
            <stop offset="65%" stopColor="hsl(var(--accent))" stopOpacity="0.35" />
            <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="aurora-b" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity="0" />
            <stop offset="40%" stopColor="hsl(var(--accent))" stopOpacity="0.22" />
            <stop offset="70%" stopColor="hsl(var(--primary))" stopOpacity="0.22" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </linearGradient>
          <filter id="aurora-blur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="42" />
          </filter>
        </defs>

        {/* Wave 1 — primary→accent, slow drift right */}
        <g filter="url(#aurora-blur)" className="aurora-drift-1">
          <path
            fill="url(#aurora-a)"
            d="M-200,340 C-40,240 140,420 340,320 C540,220 700,400 900,310 C1100,220 1260,380 1460,300 C1560,260 1640,320 1640,320 L1640,600 L-200,600 Z"
          />
        </g>

        {/* Wave 2 — accent→primary, slower drift left */}
        <g filter="url(#aurora-blur)" className="aurora-drift-2">
          <path
            fill="url(#aurora-b)"
            d="M-200,420 C0,360 180,470 380,410 C580,350 760,460 960,400 C1160,340 1340,450 1540,395 L1640,395 L1640,600 L-200,600 Z"
          />
        </g>

        {/* Waveform bars — faint equalizer pulse along the base */}
        <g className="aurora-bars" fill="hsl(var(--primary))" opacity="0.10">
          {Array.from({ length: 48 }, (_, i) => {
            const h = 18 + ((i * 37) % 54);
            return (
              <rect
                key={i}
                x={i * 30 + 8}
                y={600 - h}
                width={12}
                height={h}
                rx={3}
                style={{ animationDelay: `${(i % 8) * 0.35}s` }}
                className="aurora-bar"
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}
