const airports = {
  AMS: { lat: 52.3086, lon: 4.7639, name: "Amsterdam Schiphol" },
  BCN: { lat: 41.2974, lon: 2.0833, name: "Barcelona" },
  LHR: { lat: 51.47, lon: -0.4543, name: "London Heathrow" },
  JFK: { lat: 40.6413, lon: -73.7781, name: "New York JFK" },
  DXB: { lat: 25.2532, lon: 55.3657, name: "Dubai" },
  CDG: { lat: 49.0097, lon: 2.5479, name: "Paris CDG" }
};

function interpolate(from, to, progress) {
  return {
    lat: from.lat + (to.lat - from.lat) * progress,
    lon: from.lon + (to.lon - from.lon) * progress
  };
}

function demoProgress(flight) {
  const seed = [...flight.flight_number].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const phase = ((Date.now() / 1000 + seed * 31) % 9000) / 9000;
  return Math.min(0.98, Math.max(0.02, phase));
}

function demoRoute(flight) {
  const origin = airports[flight.origin_iata] || airports.AMS;
  const destination = airports[flight.destination_iata] || airports.BCN;
  const progress = demoProgress(flight);
  const pos = interpolate(origin, destination, progress);
  return {
    provider: "demo",
    status: progress < 0.1 ? "departed" : progress > 0.9 ? "approaching" : "airborne",
    lat: pos.lat,
    lon: pos.lon,
    altitude_ft: progress < 0.15 || progress > 0.85 ? 12000 + progress * 12000 : 36000,
    ground_speed_kts: 430 + Math.round(progress * 35),
    heading: Math.round(Math.atan2(destination.lon - origin.lon, destination.lat - origin.lat) * 180 / Math.PI),
    estimated_arrival: new Date(Date.now() + (1 - progress) * 2.5 * 60 * 60 * 1000).toISOString(),
    raw: { origin, destination, progress }
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
  if (!response.ok) {
    throw new Error(`Provider gaf HTTP ${response.status}`);
  }
  return response.json();
}

async function openskyLookup(flight) {
  const username = process.env.OPENSKY_CLIENT_ID;
  const password = process.env.OPENSKY_CLIENT_SECRET;
  const headers = username && password
    ? { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` }
    : {};
  const data = await fetchJson("https://opensky-network.org/api/states/all", { headers });
  const callsign = flight.flight_number.replace(/\s+/g, "").toUpperCase();
  const match = (data.states || []).find((state) => String(state[1] || "").trim().replace(/\s+/g, "") === callsign);

  if (!match) {
    return null;
  }

  return {
    provider: "opensky",
    status: "airborne",
    lat: match[6],
    lon: match[5],
    altitude_ft: match[7] ? Math.round(match[7] * 3.28084) : null,
    ground_speed_kts: match[9] ? Math.round(match[9] * 1.94384) : null,
    heading: match[10],
    raw: { state: match }
  };
}

async function adsbLolLookup(flight) {
  const callsign = flight.flight_number.replace(/\s+/g, "").toUpperCase();
  const data = await fetchJson(`https://api.adsb.lol/v2/callsign/${encodeURIComponent(callsign)}`);
  const aircraft = data.ac?.[0];

  if (!aircraft || aircraft.lat == null || aircraft.lon == null) {
    return null;
  }

  return {
    provider: "adsblol",
    status: "airborne",
    lat: aircraft.lat,
    lon: aircraft.lon,
    altitude_ft: aircraft.alt_baro === "ground" ? 0 : aircraft.alt_baro,
    ground_speed_kts: aircraft.gs,
    heading: aircraft.track,
    raw: aircraft
  };
}

export async function lookupFlight(flight) {
  const provider = (process.env.FLIGHT_PROVIDER || "demo").toLowerCase();

  try {
    if (provider === "opensky") {
      return await openskyLookup(flight);
    }
    if (provider === "adsblol") {
      return await adsbLolLookup(flight);
    }
    if (provider === "flightaware" || provider === "fr24") {
      return { ...demoRoute(flight), provider, status: "needs_provider_key" };
    }
    return demoRoute(flight);
  } catch (error) {
    return { ...demoRoute(flight), provider: "demo_fallback", raw: { providerError: error.message } };
  }
}
