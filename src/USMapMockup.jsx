import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { feature, mesh } from "topojson-client";

import Legend from "./components/Legend.jsx";
import useZoom from "./hooks/useZoom.js";

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

const DATA_API_BASE =
  (import.meta && import.meta.env && import.meta.env.VITE_DATA_API_URL) ||
  "http://127.0.0.1:12000";


// Sample values (0..1) to demo coloring

// County sample values (5-digit FIPS) for CA and TX, etc.

const STATES_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";
const COUNTIES_URL =
  "https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json";

const WIDTH = 980;
const HEIGHT = 610;


export default function USMapMockup() {
  const svgRef = useRef(null);
  const gRef = useRef(null);
  const [usStatesTopo, setUsStatesTopo] = useState(null);
  const [usCountiesTopo, setUsCountiesTopo] = useState(null);
  const [stateValues, setStateValues] = useState({});
  const [countyValues, setCountyValues] = useState({});
  const [selectedStateFips, setSelectedStateFips] = useState(null);
  const [hoverLabel, setHoverLabel] = useState(null);

  // Store the full payloads for devtools inspection
  const [statePayloads, setStatePayloads] = useState({});
  const [countyPayloads, setCountyPayloads] = useState({});

  // Very light heuristic so the map can still color something.
  // Adjust this once you decide a specific metric from your API.
  function deriveValueForChoropleth(payload) {
    if (!payload) return null;
  
    console.log(payload.political_party)
    const p = payload.political_party || {};

    const p_share = p.share || {};
  
    // 1) Prefer spec fields directly
    if (typeof p_share.democratic === "number" && p_share.democratic >= 0 && p_share.democratic <= 1) {
      console.log("HERE")
      return p_share.democratic;
    }
  
    // 2) Fallback: compute from alternative labels if both sides present
    const dAlt = p.democrat ?? p.dem ?? p.D ?? p.blue;
    const rAlt = p.rep_share ?? p.republican ?? p.rep ?? p.R ?? p.red;
    if (typeof dAlt === "number" && typeof rAlt === "number" && dAlt + rAlt > 0) {
      const share = dAlt / (dAlt + rAlt);
      return Math.max(0, Math.min(1, share));
    }
  
    // 3) Demographics fallback: pick a reasonable % if available
    const demog = payload.demographics || {};
    const candidates = [
      demog.hispanic_pct,
      demog.poverty_rate_pct,
      demog.education?.bachelors_or_higher_pct,
      demog.education?.hs_or_higher_pct,
      demog.age?.under_18_pct,
      demog.age?.["18_64_pct"],
      demog.age?.["65_plus_pct"],
    ];
    for (const v of candidates) {
      if (typeof v === "number" && v >= 0 && v <= 1) return v;
    }
  
    // 4) Last resort
    return 0.5;
  }
  


  // Load /public/fips.txt and populate county/state values
  useEffect(() => {
    let cancelled = false;
  
    async function loadAll() {
      // 1) Parse FIPS file to get county 5-digit codes and state-level "SS000" codes
      const txtResp = await fetch("/fips.txt");
      if (!txtResp.ok) throw new Error(`Failed to fetch /fips.txt: ${txtResp.status}`);
      const txt = await txtResp.text();
  
      const countyCodes = [];
      const stateHeaderCodes = new Set(); // e.g., "06000" for CA
      for (const raw of txt.split(/\r?\n/)) {
        const m = raw.match(/^\s*(\d{5})\b/);
        if (!m) continue;
        const code5 = m[1];
        if (code5.slice(2) === "000") {
          stateHeaderCodes.add(code5);
        } else {
          countyCodes.push(code5);
        }
      }
  
      // 2) Ask your FastAPI for everything at once (both states & counties)
      const requested_fips = [...stateHeaderCodes, ...countyCodes];
  
      const apiResp = await fetch(DATA_API_BASE+"/data/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          demographics: true,
          political_party: true,
          requested_fips,
        }),
      });
  
      if (!apiResp.ok) {
        throw new Error(`FastAPI /data/ failed: ${apiResp.status}`);
      }
  
      const payload = await apiResp.json();
      if (cancelled) return;
  
      const byFips = payload?.response_fips || {};
  
      // 3) Split into state vs county payloads and compute map values
      const nextCountyPayloads = {};
      const nextStatePayloads = {};
      const nextCountyValues = {};
      const nextStateValues = {};
  
      for (const [key, obj] of Object.entries(byFips)) {
        // States may come back as "SS000" (5 chars) or "SS" (2 chars); handle both.
        if (key.length === 5 && key.slice(2) === "000") {
          const ss = key.slice(0, 2);
          nextStatePayloads[ss] = obj;
          nextStateValues[ss] = deriveValueForChoropleth(obj);
        } else if (key.length === 2) {
          nextStatePayloads[key] = obj;
          nextStateValues[key] = deriveValueForChoropleth(obj);
        } else if (key.length === 5) {
          nextCountyPayloads[key] = obj;
          nextCountyValues[key] = deriveValueForChoropleth(obj);
        }
      }
  
      // 4) For any state missing a direct state value, derive from its counties
      const statesSeen = new Set(
        [...Object.keys(nextStatePayloads), ...Object.keys(nextStateValues)]
      );
      // Build from counties by 2-digit prefix
      const sum = {};
      const count = {};
      for (const [fips5, val] of Object.entries(nextCountyValues)) {
        const ss = fips5.slice(0, 2);
        sum[ss] = (sum[ss] || 0) + (typeof val === "number" ? val : 0);
        count[ss] = (count[ss] || 0) + 1;
      }
      for (const ss of Object.keys(sum)) {
        if (!statesSeen.has(ss) && count[ss] > 0) {
          nextStateValues[ss] = sum[ss] / count[ss];
        }
      }
  
      // 5) Commit to state + expose for inspector
      setCountyPayloads(nextCountyPayloads);
      setStatePayloads(nextStatePayloads);
      setCountyValues(nextCountyValues);
      setStateValues(nextStateValues);
  
      if (typeof window !== "undefined") {
        window.__FIPS_DATA__ = byFips;             // raw response keyed by requested id
        window.__STATE_PAYLOADS__ = nextStatePayloads;   // keyed by "SS"
        window.__COUNTY_PAYLOADS__ = nextCountyPayloads; // keyed by "SSCCC"
        console.info("FIPS data loaded:", {
          states: Object.keys(nextStatePayloads).length,
          counties: Object.keys(nextCountyPayloads).length,
        });
      }
    }
  
    loadAll().catch(err => console.error(err));
    return () => { cancelled = true; };
  }, []);

// Fetch TopoJSON
  useEffect(() => {
    Promise.all([
      fetch(STATES_URL).then((r) => r.json()),
      fetch(COUNTIES_URL).then((r) => r.json()),
    ])
      .then(([statesTopo, countiesTopo]) => {
        setUsStatesTopo(statesTopo);
        setUsCountiesTopo(countiesTopo);
      })
      .catch((err) => console.error("Failed to load topojson:", err));
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
  const colorState = useMemo(
    () => d3.scaleSequential(d3.interpolateBlues).domain([0, 1]),
    [],
  );
  const colorCounty = useMemo(
    () => d3.scaleSequential(d3.interpolateOrRd).domain([0, 1]),
    [],
  );

  // Projection/path
  const projection = useMemo(
    () =>
      d3
        .geoAlbersUsa()
        .translate([WIDTH / 2, HEIGHT / 2])
        .scale(1280),
    [],
  );
  const path = useMemo(() => d3.geoPath(projection), [projection]);

  const selectedStateFeature = useMemo(
    () => (selectedStateFips ? stateFeatures.find((s) => s.id === selectedStateFips) : null),
    [selectedStateFips, stateFeatures]
  );
  
  useZoom({
    svgRef,
    gRef,
    path,
    featureToZoom: selectedStateFeature,
    width: WIDTH,
    height: HEIGHT,
  });

  // Render paths each time data or selection changes
  useEffect(() => {
    const g = d3.select(gRef.current);
    if (!stateFeatures.length) return;

    // Clear
    g.selectAll("*").remove();

    // Draw states layer (always present for context)
    g
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
        setHoverLabel(
          `${d.properties.name} — ${v == null ? "(no value)" : (v * 100).toFixed(1) + "%"}`,
        );
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
          const name = d.properties.name;
          setHoverLabel(
            `${name} — ${v == null ? "(no value)" : (v * 100).toFixed(1) + "%"}`,
          );
        })
        .on("mouseleave", () => setHoverLabel(null));
    }

    // Optional: state borders mesh on top for crisp lines
    if (usStatesTopo) {
      const borders = mesh(
        usStatesTopo,
        usStatesTopo.objects.states,
        (a, b) => a !== b,
      );
      g.append("path")
        .attr("class", "state-borders")
        .attr("d", path(borders))
        .attr("fill", "none")
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.2)
        .attr("pointer-events", "none");
    }
  }, [
    stateFeatures,
    countiesOfSelected,
    selectedStateFips,
    stateValues,
    countyValues,
    colorState,
    colorCounty,
    path,
    usStatesTopo,
  ]);

  const reset = () => setSelectedStateFips(null);

  return (
    <div className="w-full max-w-6xl mx-auto p-4">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-semibold">
          US Map Mockup — States with County Drilldown
        </h1>
        <div className="flex items-center gap-2">
          {selectedStateFips ? (
            <button
              onClick={reset}
              className="px-3 py-1.5 rounded-2xl bg-gray-800 text-white shadow"
            >
              Reset view
            </button>
          ) : null}
        </div>
      </div>

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full h-auto rounded-2xl shadow bg-black"
        >
          <g ref={gRef} />
        </svg>
        {hoverLabel && (
          <div className="absolute top-2 left-2 px-2 py-1 bg-black/70 text-white text-sm rounded">
            {hoverLabel}
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <Legend
          title="State values"
          scale={d3.scaleSequential(d3.interpolateBlues).domain([0, 1])}
        />
        <Legend
          title="County values"
          scale={d3.scaleSequential(d3.interpolateOrRd).domain([0, 1])}
        />
      </div>

      <p className="text-sm text-gray-600 mt-3">
        Tip: Click a state to drill into its counties. Replace the sample value
        maps with your data (keys are FIPS: 2-digit for states, 5-digit for
        counties).
      </p>
    </div>
  );
}

