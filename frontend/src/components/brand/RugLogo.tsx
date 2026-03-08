interface RugLogoProps {
  size?: number
  className?: string
}

export function RugLogo({ size = 48, className }: RugLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      aria-label="TOD logo"
      role="img"
    >
      {/* Outer border frame - burgundy */}
      <rect x="2" y="2" width="60" height="60" rx="8" fill="none" stroke="#8B1A1A" strokeWidth="2"/>

      {/* Inner border - cream */}
      <rect x="6" y="6" width="52" height="52" rx="5" fill="none" stroke="#F5E6C8" strokeWidth="1.5"/>

      {/* Rug field background */}
      <rect x="8" y="8" width="48" height="48" rx="4" fill="#8B1A1A" opacity="0.15"/>

      {/* Outer diamond frame - burgundy */}
      <path d="M32 8 L56 32 L32 56 L8 32 Z" fill="none" stroke="#8B1A1A" strokeWidth="2"/>

      {/* Middle diamond - cream */}
      <path d="M32 13 L51 32 L32 51 L13 32 Z" fill="none" stroke="#F5E6C8" strokeWidth="1.5"/>

      {/* Inner diamond - burgundy */}
      <path d="M32 18 L46 32 L32 46 L18 32 Z" fill="#8B1A1A"/>

      {/* Rosette petals - vertical - teal */}
      <path d="M32 19 L38 32 L32 45 L26 32 Z" fill="#2A9D8F"/>

      {/* Rosette petals - horizontal - cream */}
      <path d="M19 32 L32 26 L45 32 L32 38 Z" fill="#F5E6C8"/>

      {/* Center medallion - burgundy */}
      <circle cx="32" cy="32" r="5" fill="#8B1A1A"/>

      {/* Center dot - teal */}
      <circle cx="32" cy="32" r="2.5" fill="#2A9D8F"/>

      {/* Corner ornaments - teal */}
      <path d="M10 10 L16 10 L10 16 Z" fill="#2A9D8F" opacity="0.7"/>
      <path d="M54 10 L54 16 L48 10 Z" fill="#2A9D8F" opacity="0.7"/>
      <path d="M10 54 L16 54 L10 48 Z" fill="#2A9D8F" opacity="0.7"/>
      <path d="M54 54 L48 54 L54 48 Z" fill="#2A9D8F" opacity="0.7"/>

      {/* Edge tick marks - cream */}
      <line x1="32" y1="3" x2="32" y2="7" stroke="#F5E6C8" strokeWidth="1" opacity="0.5"/>
      <line x1="32" y1="57" x2="32" y2="61" stroke="#F5E6C8" strokeWidth="1" opacity="0.5"/>
      <line x1="3" y1="32" x2="7" y2="32" stroke="#F5E6C8" strokeWidth="1" opacity="0.5"/>
      <line x1="57" y1="32" x2="61" y2="32" stroke="#F5E6C8" strokeWidth="1" opacity="0.5"/>
    </svg>
  )
}
