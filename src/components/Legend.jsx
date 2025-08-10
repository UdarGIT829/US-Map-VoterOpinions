import React, { useMemo } from "react";
import * as d3 from "d3";

export default function Legend({ title, scale, width = 340 }) {
  const id = useMemo(() => `grad-${Math.random().toString(36).slice(2)}`, []);
  const stops = d3.range(0, 1.0001, 0.1).map((t) => ({ t, c: scale(t) }));

  return (
    <div className="bg-zinc-900 rounded-2xl p-3 shadow">
      <div className="text-sm font-medium mb-2">{title}</div>
      <svg width={width} height={54}>
        <defs>
          <linearGradient id={id} x1="0%" x2="100%">
            {stops.map((s, i) => (
              <stop key={i} offset={`${s.t * 100}%`} stopColor={s.c} />
            ))}
          </linearGradient>
        </defs>
        <rect x={10} y={10} width={width - 40} height={14} fill={`url(#${id})`} stroke="#27272a" />
        <g fontSize={10} fill="#d4d4d8">
          <text x={10} y={40}>0%</text>
          <text x={(width - 40) / 2 + 10} y={40} textAnchor="middle">50%</text>
          <text x={width - 30} y={40} textAnchor="end">100%</text>
        </g>
      </svg>
    </div>
  );
}
