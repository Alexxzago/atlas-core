import React from "react";

/**
 * AtlasAtmosphere renders the celestial horizon, golden corona glow,
 * and subtle stardust particles inspired by the approved HOTFIX054 mock.
 * It is completely non-intrusive (pointer-events: none, z-index: 0),
 * fully GPU-accelerated, and sits gracefully behind all content.
 */
export function AtlasAtmosphere(): React.JSX.Element {
  return (
    <div className="atlas-atmosphere" aria-hidden="true">
      {/* Planetary Horizon Glow & Warm Golden Corona */}
      <div className="atlas-atmosphere__horizon" />
      <div className="atlas-atmosphere__corona" />
      <div className="atlas-atmosphere__lightbeam" />

      {/* Subtle Cosmic Stardust Particles (pure SVG, zero runtime overhead) */}
      <svg
        className="atlas-atmosphere__particles"
        viewBox="0 0 1440 900"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
      >
        <circle cx="820" cy="140" r="1.5" fill="#fef08a" opacity="0.65" className="particle-spark p1" />
        <circle cx="940" cy="90" r="1" fill="#fcd34d" opacity="0.5" className="particle-spark p2" />
        <circle cx="1060" cy="180" r="2" fill="#fbbf24" opacity="0.7" className="particle-spark p3" />
        <circle cx="1120" cy="110" r="1.5" fill="#ffffff" opacity="0.6" className="particle-spark p4" />
        <circle cx="1200" cy="220" r="1" fill="#fde68a" opacity="0.45" className="particle-spark p5" />
        <circle cx="1280" cy="150" r="2" fill="#f59e0b" opacity="0.75" className="particle-spark p6" />
        <circle cx="1340" cy="80" r="1.5" fill="#ffffff" opacity="0.55" className="particle-spark p7" />
        <circle cx="1380" cy="200" r="1" fill="#fbbf24" opacity="0.4" className="particle-spark p8" />

        {/* Upper atmosphere secondary dust */}
        <circle cx="750" cy="80" r="1" fill="#ffffff" opacity="0.4" className="particle-spark p2" />
        <circle cx="890" cy="220" r="1.5" fill="#fcd34d" opacity="0.55" className="particle-spark p5" />
        <circle cx="1010" cy="60" r="1.2" fill="#ffffff" opacity="0.6" className="particle-spark p1" />
        <circle cx="1150" cy="260" r="1" fill="#f59e0b" opacity="0.4" className="particle-spark p4" />
        <circle cx="1240" cy="70" r="1.8" fill="#fef08a" opacity="0.7" className="particle-spark p3" />
        <circle cx="1310" cy="290" r="1" fill="#fde68a" opacity="0.35" className="particle-spark p6" />
        <circle cx="1410" cy="130" r="1.5" fill="#ffffff" opacity="0.5" className="particle-spark p7" />
      </svg>
    </div>
  );
}
