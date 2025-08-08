import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { feature, mesh } from "topojson-client";

/**
 * US Map Mockup
 * - Loads US states and counties TopoJSON from the us-atlas CDN
 * - Colors states using a sample mapping
 * - Click a state to drill into county-level coloring (only that state's counties render)
 * - "Reset" to zoom back out to the full US and state-level coloring
 *
 * How to adapt:
 *  - Replace `STATE_VALUES` and `COUNTY_VALUES` with your data (keys are FIPS)
 *  - Call setStateValues/setCountyValues from props or data fetch if you wire it up
 *  - Styling uses Tailwind classes (available in this environment)
 */

// State postal -> 2-digit FIPS (string)
const STATE_FIPS = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08",
  CT: "09", DE: "10", DC: "11", FL: "12", GA: "13", HI: "15",
  ID: "16", IL: "17", IN: "18", IA: "19", KS: "20", KY: "21",
  LA: "22", ME: "23", MD: "24", MA: "25", MI: "26", MN: "27",
  MS: "28", MO: "29", MT: "30", NE: "31", NV: "32", NH: "33",
  NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38", OH: "39",
  OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46",
  TN: "47", TX: "48", UT: "49", VT: "50", VA: "51", WA: "53",
  WV: "54", WI: "55", WY: "56", PR: "72",
};

// Sample values (0..1) to demo coloring
const STATE_VALUES_SAMPLE = {
  [STATE_FIPS.CA]: 0.72,
  [STATE_FIPS.TX]: 0.41,
  [STATE_FIPS.NY]: 0.66,
  [STATE_FIPS.FL]: 0.48,
  [STATE_FIPS.OH]: 0.53,
  [STATE_FIPS.AZ]: 0.57,
};

// County sample values (5-digit FIPS) for CA and TX, etc.
const COUNTY_VALUES_SAMPLE = {
  // California
  "06001": 0.63, // Alameda
  "06013": 0.61, // Contra Costa
  "06037": 0.75, // Los Angeles
  "06059": 0.52, // Orange
  "06073": 0.56, // San Diego
  "06075": 0.84, // San Francisco
  // Texas
  "48201": 0.44, // Harris
  "48113": 0.46, // Dallas
  "48453": 0.39, // Travis
  "48141": 0.42, // El Paso
  // Florida
  "12086": 0.55, // Miami-Dade
  "12011": 0.51, // Broward
  // New York
  "36061": 0.82, // New York County
  "36047": 0.74, // Kings
  // Ohio
  "39049": 0.51, // Franklin
  "39035": 0.49, // Cuyahoga
};

const STATES_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";
const COUNTIES_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json";

const WIDTH = 980;
const HEIGHT = 610;

export default function USMapMockup() {
  const svgRef = useRef(null);
  const gRef = useRef(null);
  const [usStatesTopo, setUsStatesTopo] = useState(null);
  const [usCountiesTopo, setUsCountiesTopo] = useState(null);
  const [stateValues, setStateValues] = useState(STATE_VALUES_SAMPLE);
  const [countyValues, setCountyValues] = useState(COUNTY_VALUES_SAMPLE);
  const [selectedStateFips, setSelectedStateFips] = useState(null);
  const [hoverLabel, setHoverLabel] = useState(null);

  // Fetch TopoJSON
  useEffect(() => {
    Promise.all([
      fetch(STATES_URL).then((r) => r.json()),
      fetch(COUNTIES_URL).then((r) => r.json()),
    ]).then(([statesTopo, countiesTopo]) => {
      setUsStatesTopo(statesTopo);
      setUsCountiesTopo(countiesTopo);
    }).catch((err) => console.error("Failed to load topojson:", err));
  }, []);

  // Convert to GeoJSON features
  const stateFeatures = useMemo(() => {
    if (!usStatesTopo) return [];
    const f = feature(usStatesTopo, usStatesTopo.objects.states).features;
    // Ensure each has a 2-digit string id
    return f.map((d) => ({ ...d, id: String(d.id).padStart(2, "0") }));
  }, [usStatesTopo]);

  const countyFeatures = useMemo(() => {
    if (!usCountiesTopo) return [];
    const f = feature(usCountiesTopo, usCountiesTopo.objects.counties).features;
    // Ensure 5-digit string ids
    return f.map((d) => ({ ...d, id: String(d.id).padStart(5, "0") }));
  }, [usCountiesTopo]);

  // Derived: counties for selected state
  const countiesOfSelected = useMemo(() => {
    if (!selectedStateFips) return [];
    return countyFeatures.filter((c) => c.id.slice(0, 2) === selectedStateFips);
  }, [countyFeatures, selectedStateFips]);

  // Color scales
  const colorState = useMemo(() => d3.scaleSequential(d3.interpolateBlues).domain([0, 1]), []);
  const colorCounty = useMemo(() => d3.scaleSequential(d3.interpolateOrRd).domain([0, 1]), []);

  // Projection/path
  const projection = useMemo(() => d3.geoAlbersUsa().translate([WIDTH / 2, HEIGHT / 2]).scale(1280), []);
  const path = useMemo(() => d3.geoPath(projection), [projection]);

  // Zoom behavior
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    const g = d3.select(gRef.current);

    const zoom = d3.zoom().scaleExtent([1, 12]).on("zoom", (event) => {
      g.attr("transform", event.transform);
    });

    svg.call(zoom);

    const zoomTo = (featureGeom) => {
      const bounds = path.bounds(featureGeom);
      const dx = bounds[1][0] - bounds[0][0];
      const dy = bounds[1][1] - bounds[0][1];
      const x = (bounds[0][0] + bounds[1][0]) / 2;
      const y = (bounds[0][1] + bounds[1][1]) / 2;
      const scale = Math.max(1, Math.min(12, 0.9 / Math.max(dx / WIDTH, dy / HEIGHT)));
      const translate = [WIDTH / 2 - scale * x, HEIGHT / 2 - scale * y];
      svg.transition().duration(700).call(zoom.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale));
    };

    // If a state is selected, zoom to it; else reset
    if (selectedStateFips) {
      const sf = stateFeatures.find((s) => s.id === selectedStateFips);
      if (sf) zoomTo(sf);
    } else {
      svg.transition().duration(700).call(zoom.transform, d3.zoomIdentity);
    }
  }, [selectedStateFips, stateFeatures, path]);

  // Render paths each time data or selection changes
  useEffect(() => {
    const g = d3.select(gRef.current);
    if (!stateFeatures.length) return;

    // Clear
    g.selectAll("*").remove();

    // Draw states layer (always present for context)
    const states = g
      .append("g")
      .attr("class", "states")
      .selectAll("path")
      .data(stateFeatures)
      .enter()
      .append("path")
      .attr("d", path)
      .attr("fill", (d) => {
        const v = stateValues[d.id];
        return v == null ? "#e5e7eb" : colorState(v);
      })
      .attr("stroke", "#fff")
      .attr("stroke-width", 0.8)
      .style("cursor", "pointer")
      .on("click", (event, d) => setSelectedStateFips(d.id))
      .on("mousemove", (event, d) => {
        const v = stateValues[d.id];
        setHoverLabel(`${d.properties.name} — ${v == null ? "(no value)" : (v * 100).toFixed(1) + "%"}`);
      })
      .on("mouseleave", () => setHoverLabel(null));

    // If a state is selected, draw its counties layer on top
    if (selectedStateFips && countiesOfSelected.length) {
      g.append("g")
        .attr("class", "counties")
        .selectAll("path")
        .data(countiesOfSelected)
        .enter()
        .append("path")
        .attr("d", path)
        .attr("fill", (d) => {
          const v = countyValues[d.id];
          return v == null ? "#f3f4f6" : colorCounty(v);
        })
        .attr("stroke", "#fff")
        .attr("stroke-width", 0.4)
        .on("mousemove", (event, d) => {
          const v = countyValues[d.id];
          const name = `${d.properties.name} County`;
          setHoverLabel(`${name} — ${v == null ? "(no value)" : (v * 100).toFixed(1) + "%"}`);
        })
        .on("mouseleave", () => setHoverLabel(null));
    }

    // Optional: state borders mesh on top for crisp lines
    if (usStatesTopo) {
      const borders = mesh(usStatesTopo, usStatesTopo.objects.states, (a, b) => a !== b);
      g.append("path").attr("class", "state-borders").attr("d", path(borders)).attr("fill", "none").attr("stroke", "#fff").attr("stroke-width", 1.2).attr("pointer-events", "none");
    }
  }, [stateFeatures, countiesOfSelected, selectedStateFips, stateValues, countyValues, colorState, colorCounty, path, usStatesTopo]);

  const reset = () => setSelectedStateFips(null);

  return (
    <div className="w-full max-w-6xl mx-auto p-4">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-semibold">US Map Mockup — States with County Drilldown</h1>
        <div className="flex items-center gap-2">
          {selectedStateFips ? (
            <button onClick={reset} className="px-3 py-1.5 rounded-2xl bg-gray-800 text-white shadow">
              Reset view
            </button>
          ) : null}
        </div>
      </div>

      <div className="relative">
        <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto rounded-2xl shadow bg-black">
          <g ref={gRef} />
        </svg>
        {hoverLabel && (
          <div className="absolute top-2 left-2 px-2 py-1 bg-black/70 text-white text-sm rounded">
            {hoverLabel}
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <Legend title="State values" scale={d3.scaleSequential(d3.interpolateBlues).domain([0, 1])} />
        <Legend title="County values" scale={d3.scaleSequential(d3.interpolateOrRd).domain([0, 1])} />
      </div>

      <p className="text-sm text-gray-600 mt-3">
        Tip: Click a state to drill into its counties. Replace the sample value maps with your data (keys are FIPS: 2-digit for states, 5-digit for counties).
      </p>
    </div>
  );
}

function Legend({ title, scale }) {
  // Simple SVG gradient legend 0..1
  const id = useMemo(() => `grad-${Math.random().toString(36).slice(2)}`, []);
  const stops = d3.range(0, 1.0001, 0.1).map((t) => ({ t, c: scale(t) }));
  return (
    <div className="bg-white rounded-2xl p-3 shadow">
      <div className="text-sm font-medium mb-2">{title}</div>
      <svg width={340} height={54}>
        <defs>
          <linearGradient id={id} x1="0%" x2="100%">
            {stops.map((s, i) => (
              <stop key={i} offset={`${s.t * 100}%`} stopColor={s.c} />
            ))}
          </linearGradient>
        </defs>
        <rect x={10} y={10} width={300} height={14} fill={`url(#${id})`} stroke="#e5e7eb" />
        <g fontSize={10} fill="#374151">
          <text x={10} y={40}>0%</text>
          <text x={150} y={40} textAnchor="middle">50%</text>
          <text x={310} y={40} textAnchor="end">100%</text>
        </g>
      </svg>
    </div>
  );
}
