import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { Plane } from "lucide-react";

const style = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "OpenStreetMap"
    }
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }]
};

function toNumber(value) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
      zoom: 4
    });
    map.current.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  }, []);

  useEffect(() => {
    if (!map.current) return;

    const activeIds = new Set();
    flights.forEach((flight) => {
      const lat = toNumber(flight.last_lat);
      const lon = toNumber(flight.last_lon);
      if (lat == null || lon == null) return;

      activeIds.add(flight.id);
      let marker = markers.current.get(flight.id);
      if (!marker) {
        const element = document.createElement("button");
        element.className = "plane-marker";
        element.type = "button";
        element.innerHTML = "<span></span>";
        element.addEventListener("click", () => onSelect(flight.id));
        marker = new maplibregl.Marker({ element }).setLngLat([lon, lat]).addTo(map.current);
        markers.current.set(flight.id, marker);
      }

      marker.setLngLat([lon, lat]);
      marker.getElement().querySelector("span").style.rotate = `${Number(flight.last_heading || 0)}deg`;
      marker.getElement().classList.toggle("active", selectedFlight?.id === flight.id);
      marker.setPopup(
        new maplibregl.Popup({ offset: 18 }).setHTML(`
          <strong>${flight.flight_number}</strong><br/>
          ${flight.passenger_name}<br/>
          ${flight.origin_iata || "???"} naar ${flight.destination_iata || "???"}<br/>
          ${flight.status}
        `)
      );
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
      map.current.easeTo({ center: [selectedLon, selectedLat], zoom: Math.max(map.current.getZoom(), 5), duration: 700 });
    }
  }, [flights, selectedFlight, onSelect]);

  return (
    <div className="map-wrap">
      <div ref={container} className="map" />
      <div className="map-overlay">
        <Plane size={18} />
        <span>{selectedFlight ? `${selectedFlight.flight_number} - ${selectedFlight.passenger_name}` : "Geen vlucht geselecteerd"}</span>
      </div>
    </div>
  );
}
