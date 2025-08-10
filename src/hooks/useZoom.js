import { useEffect } from "react";
import * as d3 from "d3";

/**
 * Adds pan/zoom to an <svg> and zooms to a feature when provided.
 * Params:
 *  - svgRef, gRef: refs to <svg> and inner <g>
 *  - path: a d3.geoPath(projection)
 *  - featureToZoom: GeoJSON Feature or null
 *  - width, height: svg viewBox size
 */
export default function useZoom({ svgRef, gRef, path, featureToZoom, width, height }) {
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    const g = d3.select(gRef.current);

    const zoom = d3.zoom().scaleExtent([1, 12]).on("zoom", (event) => {
      g.attr("transform", event.transform);
    });

    svg.call(zoom);

    const reset = () => {
      svg.transition().duration(700).call(zoom.transform, d3.zoomIdentity);
    };

    const zoomTo = (geom) => {
      const bounds = path.bounds(geom);
      const dx = bounds[1][0] - bounds[0][0];
      const dy = bounds[1][1] - bounds[0][1];
      const x = (bounds[0][0] + bounds[1][0]) / 2;
      const y = (bounds[0][1] + bounds[1][1]) / 2;
      const scale = Math.max(1, Math.min(12, 0.9 / Math.max(dx / width, dy / height)));
      const translate = [width / 2 - scale * x, height / 2 - scale * y];
      svg.transition().duration(700)
        .call(zoom.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale));
    };

    if (featureToZoom) zoomTo(featureToZoom);
    else reset();
  }, [svgRef, gRef, path, featureToZoom, width, height]);
}
