import React from 'react';

interface LogoProps {
  className?: string;
  variant?: 'light' | 'dark';
}

export default function Logo({ className = '', variant = 'dark' }: LogoProps) {
  const color = variant === 'light' ? '#FFFFFF' : '#166534';

  // Leaf: base at (0,0), tip at (0,-12). Rotate so tip points outward from wreath centre.
  const leaf = 'M 0,0 C -3.5,-2 -5,-7 0,-12 C 5,-7 3.5,-2 0,0 Z';
  const tinyLeaf = 'M 0,0 C -2.5,-1.5 -3.5,-5 0,-8 C 3.5,-5 2.5,-1.5 0,0 Z';

  const cx = 33; // wreath centre x
  const cy = 32; // wreath centre y
  const R = 17; // stem-ring radius

  // Build a translate+rotate transform so a leaf sits at the given compass bearing
  // (degrees clockwise from North / 12 o'clock) and points outward.
  function T(bearing: number, radius: number = R): string {
    const rad = (bearing * Math.PI) / 180;
    const x = cx + radius * Math.sin(rad);
    const y = cy - radius * Math.cos(rad);
    return `translate(${x.toFixed(2)},${y.toFixed(2)}) rotate(${bearing})`;
  }

  // Left branch : bearing 210 → 354 (lower-left, sweeping up through the west side)
  const leftBearings = [210, 228, 246, 264, 282, 300, 318, 336, 354];
  // Right branch: mirror — bearing 150 → 6 (lower-right, sweeping up through the east side)
  const rightBearings = [150, 132, 114, 96, 78, 60, 42, 24, 6];
  // Bottom knot: three small leaves centred below
  const bottomBearings = [165, 180, 195];

  return (
    <svg
      viewBox="0 0 258 66"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Olympia"
      role="img"
    >
      <g fill={color}>
        {leftBearings.map((b) => (
          <path key={`l-${b}`} d={leaf} transform={T(b)} />
        ))}
        {rightBearings.map((b) => (
          <path key={`r-${b}`} d={leaf} transform={T(b)} />
        ))}
        {bottomBearings.map((b) => (
          <path key={`bt-${b}`} d={tinyLeaf} transform={T(b, R - 2)} />
        ))}
      </g>

      {/* Wordmark */}
      <text
        x="70"
        y="43"
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
        fontWeight="800"
        fontSize="34"
        fill={color}
        letterSpacing="-0.5"
      >
        LYMPIA
      </text>
    </svg>
  );
}
