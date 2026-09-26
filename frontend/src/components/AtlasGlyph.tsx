export function AtlasGlyph({ className = "", size = 24 }: { readonly className?: string; readonly size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="atlas-glyph-gold" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FDE047" />
          <stop offset="45%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#D97706" />
        </linearGradient>
      </defs>
      <path
        d="M12 2.5L21.5 21.5H16.8L12 11.2L7.2 21.5H2.5L12 2.5Z"
        fill="url(#atlas-glyph-gold)"
      />
    </svg>
  );
}
