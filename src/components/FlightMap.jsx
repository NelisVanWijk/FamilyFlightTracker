import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { Activity, Gauge, Navigation, Plane, Radio, Signal } from "lucide-react";

const style = {
  version: 8,
  sources: {
    dark: {
      type: "raster",
      tiles: ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"],
      tileSize: 256,
      attribution: "OpenStreetMap, CARTO"
    }
  },
  layers: [{ id: "dark", type: "raster", source: "dark" }]
};

function toNumber(value) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value, suffix = "") {
  const number = toNumber(value);
  return number == null ? "-" : `${Math.round(number)}${suffix}`;
}

function formatTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function rawOf(flight) {
  return flight?.latest_position_raw || {};
}

function createPlaneElement() {
  const element = document.createElement("button");
  element.className = "plane-marker";
  element.type = "button";
  element.innerHTML = `
    <span class="plane-marker-airframe">
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M32 4c2.2 0 3.9 1.8 3.9 4v15.7l20.8 13.1c1.2.8 1.9 2.1 1.9 3.5v4.9L35.9 38v12.2l7.9 5.4v4.3L32 56.4 20.2 60v-4.3l7.9-5.4V38L5.4 45.2v-4.9c0-1.4.7-2.7 1.9-3.5l20.8-13.1V8c0-2.2 1.7-4 3.9-4Z" />
      </svg>
    </span>
  `;
  return element;
}

function animateMarker(marker, nextLngLat) {
  const start = marker.getLngLat();
  const startTime = performance.now();
  const duration = 850;

  function frame(now) {
    const progress = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const lng = start.lng + (nextLngLat[0] - start.lng) * eased;
    const lat = start.lat + (nextLngLat[1] - start.lat) * eased;
    marker.setLngLat([lng, lat]);
    if (progress < 1) {
      requestAnimationFrame(frame);
    }
  }

  requestAnimationFrame(frame);
}

function trailFeature(flight) {
  const coordinates = (flight.positions || [])
    .map((position) => [toNumber(position.lon), toNumber(position.lat)])
    .filter(([lon, lat]) => lon != null && lat != null);

  if (coordinates.length < 2) {
    return null;
  }

  return {
    type: "Feature",
    properties: { id: flight.id, selected: false },
    geometry: { type: "LineString", coordinates }
  };
}

export function FlightMap({ flights, selectedFlight, onSelect }) {
  const container = useRef(null);
  const map = useRef(null);
  const markers = useRef(new Map());

  useEffect(() => {
    if (!container.current || map.current) return;
    map.current = new maplibregl.Map({
      container: container.current,
      style,
      center: [4.7639, 52.3086],
      zoom: 4,
      pitch: 28
    });
    map.current.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.current.on("load", () => {
      map.current.addSource("flight-trails", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
      map.current.addLayer({
        id: "flight-trails-glow",
        type: "line",
        source: "flight-trails",
        paint: {
          "line-color": "#23d0b2",
          "line-width": 7,
          "line-opacity": 0.16
        }
      });
      map.current.addLayer({
        id: "flight-trails",
        type: "line",
        source: "flight-trails",
        paint: {
          "line-color": "#23d0b2",
          "line-width": 2,
          "line-opacity": 0.86
        }
      });
    });
  }, []);

  useEffect(() => {
    if (!map.current) return;

    const trailSource = map.current.getSource("flight-trails");
    if (trailSource) {
      trailSource.setData({
        type: "FeatureCollection",
        features: flights.map(trailFeature).filter(Boolean)
      });
    }

    const activeIds = new Set();
    flights.forEach((flight) => {
      const lat = toNumber(flight.last_lat);
      const lon = toNumber(flight.last_lon);
      if (lat == null || lon == null) return;

      activeIds.add(flight.id);
      let marker = markers.current.get(flight.id);
      if (!marker) {
        const element = createPlaneElement();
        element.addEventListener("click", () => onSelect(flight.id));
        marker = new maplibregl.Marker({ element, anchor: "center" }).setLngLat([lon, lat]).addTo(map.current);
        markers.current.set(flight.id, marker);
      } else {
        animateMarker(marker, [lon, lat]);
      }

      const element = marker.getElement();
      element.querySelector(".plane-marker-airframe").style.rotate = `${Number(flight.last_heading || 0)}deg`;
      element.classList.toggle("active", selectedFlight?.id === flight.id);
      element.title = `${flight.flight_number} ${formatNumber(flight.last_altitude_ft, " ft")} ${formatNumber(flight.last_ground_speed_kts, " kt")}`;
    });

    markers.current.forEach((marker, id) => {
      if (!activeIds.has(id)) {
        marker.remove();
        markers.current.delete(id);
      }
    });

    const selectedLat = toNumber(selectedFlight?.last_lat);
    const selectedLon = toNumber(selectedFlight?.last_lon);
    if (selectedLat != null && selectedLon != null) {
      map.current.easeTo({
        center: [selectedLon, selectedLat],
        zoom: Math.max(map.current.getZoom(), 6.3),
        bearing: Number(selectedFlight.last_heading || 0) - 18,
        duration: 900
      });
    }
  }, [flights, selectedFlight, onSelect]);

  const raw = rawOf(selectedFlight);

  return (
    <div className="map-wrap">
      <div ref={container} className="map" />
      <section className="radar-panel">
        <div className="radar-title">
          <Plane size={20} />
          <div>
            <strong>{selectedFlight ? selectedFlight.flight_number : "Geen vlucht geselecteerd"}</strong>
            <span>{selectedFlight ? `${selectedFlight.origin_iata || "???"} naar ${selectedFlight.destination_iata || "???"}` : "Kies een vlucht in de lijst"}</span>
          </div>
        </div>
        {selectedFlight && (
          <div className="radar-grid">
            <span><Gauge size={15} /> {formatNumber(selectedFlight.last_altitude_ft, " ft")}</span>
            <span><Activity size={15} /> {formatNumber(selectedFlight.last_ground_speed_kts, " kt")}</span>
            <span><Navigation size={15} /> {formatNumber(selectedFlight.last_heading, " deg")}</span>
            <span><Radio size={15} /> {raw.flight?.trim() || selectedFlight.flight_number}</span>
            <span><Signal size={15} /> {raw.rssi ? `${raw.rssi} dB` : "-"}</span>
            <span>{raw.r || "-"} {raw.t ? `- ${raw.t}` : ""}</span>
            <span>Squawk {raw.squawk || "-"}</span>
            <span>VS {formatNumber(raw.baro_rate, " ft/min")}</span>
            <span>Laatst {formatTime(selectedFlight.last_seen_at)}</span>
          </div>
        )}
      </section>
    </div>
  );
}
