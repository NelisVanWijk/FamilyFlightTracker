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

const airportFallbacks = {
  AMS: { lat: 52.308601, lon: 4.76389 },
  YUL: { lat: 45.4706, lon: -73.740799 },
  BCN: { lat: 41.2974, lon: 2.0833 },
  LHR: { lat: 51.47, lon: -0.4543 },
  JFK: { lat: 40.6413, lon: -73.7781 },
  DXB: { lat: 25.2532, lon: 55.3657 },
  CDG: { lat: 49.0097, lon: 2.5479 }
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

function distanceKm(from, to) {
  const earthRadiusKm = 6371;
  const toRadians = (value) => value * Math.PI / 180;
  const dLat = toRadians(to[1] - from[1]);
  const dLon = toRadians(to[0] - from[0]);
  const lat1 = toRadians(from[1]);
  const lat2 = toRadians(to[1]);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
  const points = (flight.positions || [])
    .map((position) => ({
      coordinate: [toNumber(position.lon), toNumber(position.lat)],
      capturedAt: position.captured_at ? new Date(position.captured_at).getTime() : null
    }))
    .filter((point) => point.coordinate[0] != null && point.coordinate[1] != null);

  if (points.length < 2) {
    return null;
  }

  const segments = [];
  let segment = [points[0].coordinate];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const minutes = previous.capturedAt && current.capturedAt
      ? Math.max(0.01, (current.capturedAt - previous.capturedAt) / 60000)
      : null;
    const jumpKm = distanceKm(previous.coordinate, current.coordinate);
    const impliedKnots = minutes ? (jumpKm / 1.852) / (minutes / 60) : 0;
    const shouldSplit = jumpKm > 1200 || (minutes && minutes > 30) || (minutes && impliedKnots > 1200);

    if (shouldSplit) {
      if (segment.length > 1) {
        segments.push(segment);
      }
      segment = [current.coordinate];
    } else {
      segment.push(current.coordinate);
    }
  }

  if (segment.length > 1) {
    segments.push(segment);
  }

  if (!segments.length) {
    return null;
  }

  return {
    type: "Feature",
    properties: { id: flight.id, selected: false },
    geometry: { type: "MultiLineString", coordinates: segments }
  };
}

function plannedRouteFeature(flight) {
  let coordinates = (flight.planned_route?._airports || [])
    .map((airport) => [toNumber(airport.lon), toNumber(airport.lat)])
    .filter(([lon, lat]) => lon != null && lat != null);

  if (coordinates.length < 2) {
    const origin = airportFallbacks[flight.origin_iata];
    const destination = airportFallbacks[flight.destination_iata];
    if (origin && destination) {
      coordinates = [[origin.lon, origin.lat], [destination.lon, destination.lat]];
    }
  }

  if (coordinates.length < 2) {
    return null;
  }

  return {
    type: "Feature",
    properties: { id: flight.id },
    geometry: { type: "LineString", coordinates }
  };
}

function remainingRouteFeature(flight) {
  const currentLat = toNumber(flight.last_lat);
  const currentLon = toNumber(flight.last_lon);
  if (currentLat == null || currentLon == null) {
    return null;
  }

  const plannedAirports = flight.planned_route?._airports || [];
  const plannedDestination = plannedAirports.at(-1);
  const fallbackDestination = airportFallbacks[flight.destination_iata];
  const destination = plannedDestination || fallbackDestination;
  const destinationLat = toNumber(destination?.lat);
  const destinationLon = toNumber(destination?.lon);

  if (destinationLat == null || destinationLon == null) {
    return null;
  }

  return {
    type: "Feature",
    properties: { id: flight.id },
    geometry: {
      type: "LineString",
      coordinates: [[currentLon, currentLat], [destinationLon, destinationLat]]
    }
  };
}

export function FlightMap({ flights, selectedFlight, onSelect }) {
  const container = useRef(null);
  const map = useRef(null);
  const markers = useRef(new Map());
  const liveFrame = useRef(null);
  const liveFlights = useRef([]);
  const centeredFlightId = useRef(null);

  function setSourceData(sourceId, features) {
    const source = map.current?.getSource(sourceId);
    if (source) {
      source.setData({ type: "FeatureCollection", features });
    }
  }

  function syncRouteSources(nextFlights) {
    setSourceData("planned-routes", nextFlights.map(plannedRouteFeature).filter(Boolean));
    setSourceData("remaining-routes", nextFlights.map(remainingRouteFeature).filter(Boolean));
    setSourceData("flight-trails", nextFlights.map(trailFeature).filter(Boolean));
  }

  useEffect(() => {
    if (!container.current || map.current) return;
    map.current = new maplibregl.Map({
      container: container.current,
      style,
      center: [4.7639, 52.3086],
      zoom: 4,
      pitch: 0,
      bearing: 0
    });
    map.current.dragRotate.disable();
    map.current.touchZoomRotate.disableRotation();
    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.current.on("load", () => {
      map.current.addSource("flight-trails", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
      map.current.addSource("planned-routes", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
      map.current.addSource("remaining-routes", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
      map.current.addLayer({
        id: "planned-routes",
        type: "line",
        source: "planned-routes",
        paint: {
          "line-color": "#f4d45f",
          "line-width": 2,
          "line-opacity": 0.58,
          "line-dasharray": [2, 2]
        }
      });
      map.current.addLayer({
        id: "remaining-routes-glow",
        type: "line",
        source: "remaining-routes",
        paint: {
          "line-color": "#ffce4a",
          "line-width": 8,
          "line-opacity": 0.12
        }
      });
      map.current.addLayer({
        id: "remaining-routes",
        type: "line",
        source: "remaining-routes",
        paint: {
          "line-color": "#ffce4a",
          "line-width": 3,
          "line-opacity": 0.86
        }
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
      syncRouteSources(liveFlights.current);
    });
  }, []);

  useEffect(() => {
    if (!map.current) return;
    liveFlights.current = flights;

    syncRouteSources(flights);

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
    if (selectedLat != null && selectedLon != null && centeredFlightId.current !== selectedFlight.id) {
      centeredFlightId.current = selectedFlight.id;
      map.current.easeTo({
        center: [selectedLon, selectedLat],
        zoom: Math.max(map.current.getZoom(), 6.3),
        bearing: 0,
        pitch: 0,
        duration: 900
      });
    }
  }, [flights, selectedFlight, onSelect]);

  useEffect(() => {
    function projectedLngLat(flight) {
      const lat = toNumber(flight.last_lat);
      const lon = toNumber(flight.last_lon);
      const speedKts = toNumber(flight.last_ground_speed_kts);
      const heading = toNumber(flight.last_heading);
      const seenAt = flight.last_seen_at ? new Date(flight.last_seen_at).getTime() : Date.now();

      if (lat == null || lon == null || speedKts == null || heading == null) {
        return lat == null || lon == null ? null : [lon, lat];
      }

      const elapsedSeconds = Math.min(25, Math.max(0, (Date.now() - seenAt) / 1000));
      const distanceKm = speedKts * 1.852 * elapsedSeconds / 3600;
      const headingRad = heading * Math.PI / 180;
      const latRad = lat * Math.PI / 180;
      const earthRadiusKm = 6371;
      const projectedLat = lat + (distanceKm * Math.cos(headingRad) / earthRadiusKm) * 180 / Math.PI;
      const projectedLon = lon + (distanceKm * Math.sin(headingRad) / (earthRadiusKm * Math.cos(latRad))) * 180 / Math.PI;
      return [projectedLon, projectedLat];
    }

    function tick() {
      for (const flight of liveFlights.current) {
        const marker = markers.current.get(flight.id);
        const next = marker ? projectedLngLat(flight) : null;
        if (marker && next) {
          marker.setLngLat(next);
        }
      }
      liveFrame.current = requestAnimationFrame(tick);
    }

    liveFrame.current = requestAnimationFrame(tick);
    return () => {
      if (liveFrame.current) {
        cancelAnimationFrame(liveFrame.current);
      }
    };
  }, []);

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
