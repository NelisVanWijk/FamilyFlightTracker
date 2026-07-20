const airports = {
  AMS: { lat: 52.3086, lon: 4.7639, name: "Amsterdam Schiphol" },
  BCN: { lat: 41.2974, lon: 2.0833, name: "Barcelona" },
  LHR: { lat: 51.47, lon: -0.4543, name: "London Heathrow" },
  JFK: { lat: 40.6413, lon: -73.7781, name: "New York JFK" },
  DXB: { lat: 25.2532, lon: 55.3657, name: "Dubai" },
  CDG: { lat: 49.0097, lon: 2.5479, name: "Paris CDG" }
};

const airlineIataToIcao = {
  KL: "KLM",
  HV: "TRA",
  OR: "TFL",
  FR: "RYR",
  U2: "EZY",
  BA: "BAW",
  LH: "DLH",
  AF: "AFR",
  IB: "IBE",
  VY: "VLG",
  TP: "TAP",
  LX: "SWR",
  OS: "AUA",
  SK: "SAS",
  DY: "NOZ",
  EK: "UAE",
  QR: "QTR",
  TK: "THY",
  DL: "DAL",
  UA: "UAL",
  AA: "AAL"
};

function normalizeFlightIdent(flightNumber) {
  const compact = flightNumber.replace(/\s+/g, "").toUpperCase();
  if (/^[A-Z]{3}\d/.test(compact)) {
    return compact;
  }

  const match = compact.match(/^([A-Z0-9]{2})(\d.*)$/);
  if (!match) {
    return compact;
  }
  return `${airlineIataToIcao[match[1]] || match[1]}${match[2]}`;
}

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

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function flightDateRange(flight) {
  const base = flight.flight_date ? new Date(`${flight.flight_date}T00:00:00Z`) : new Date();
  return {
    start: addDays(base, -1).toISOString(),
    end: addDays(base, 2).toISOString()
  };
}

function flightInstant(flight) {
  const value = flight.actual_off || flight.estimated_off || flight.scheduled_off || flight.actual_out || flight.estimated_out || flight.scheduled_out;
  return value ? new Date(value).getTime() : 0;
}

function chooseBestFlight(flights, trackedFlight) {
  if (!flights?.length) {
    return null;
  }

  const target = trackedFlight.flight_date ? new Date(`${trackedFlight.flight_date}T12:00:00Z`).getTime() : Date.now();
  return [...flights].sort((a, b) => Math.abs(flightInstant(a) - target) - Math.abs(flightInstant(b) - target))[0];
}

function normalizeFlightAwareStatus(flight) {
  const text = `${flight.status || ""}`.toLowerCase();
  if (flight.cancelled) return "cancelled";
  if (flight.actual_in || text.includes("arrived") || text.includes("landed")) return "landed";
  if (flight.actual_off || text.includes("en route") || text.includes("airborne")) return "airborne";
  if (flight.actual_out || text.includes("departed")) return "departed";
  if (text.includes("scheduled") || text.includes("planned")) return "planned";
  return text.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "tracked";
}

function normalizeFlightAwarePosition(position) {
  if (!position || position.latitude == null || position.longitude == null) {
    return null;
  }

  return {
    lat: position.latitude,
    lon: position.longitude,
    altitude_ft: position.altitude == null ? null : position.altitude * 100,
    ground_speed_kts: position.groundspeed ?? null,
    heading: position.heading ?? null
  };
}

function mergeFallbackPosition(live, fallback, provider) {
  if (!fallback) {
    return live;
  }

  return {
    ...live,
    provider,
    lat: fallback.lat,
    lon: fallback.lon,
    altitude_ft: fallback.altitude_ft,
    ground_speed_kts: fallback.ground_speed_kts,
    heading: fallback.heading,
    raw: { ...live.raw, fallbackPosition: fallback.raw || fallback }
  };
}

async function flightAwareFetch(path, params = {}) {
  const token = process.env.FLIGHTAWARE_API_KEY;
  if (!token) {
    throw new Error("FLIGHTAWARE_API_KEY ontbreekt");
  }

  const url = new URL(`https://aeroapi.flightaware.com/aeroapi${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  return fetchJson(url, {
    headers: {
      Accept: "application/json",
      "x-apikey": token
    }
  });
}

async function openskyLookup(flight) {
  const username = process.env.OPENSKY_CLIENT_ID;
  const password = process.env.OPENSKY_CLIENT_SECRET;
  const headers = username && password
    ? { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` }
    : {};
  const data = await fetchJson("https://opensky-network.org/api/states/all", { headers });
  const callsign = normalizeFlightIdent(flight.flight_number);
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
  const callsign = normalizeFlightIdent(flight.flight_number);
  const data = await fetchJson(`https://api.adsb.lol/v2/callsign/${encodeURIComponent(callsign)}`);
  const aircraft = data.ac?.[0];

  if (!aircraft || aircraft.lat == null || aircraft.lon == null) {
    return null;
  }

  let plannedRoute = null;
  if (!flight.planned_route_raw) {
    try {
      plannedRoute = await fetchJson(`https://api.adsb.lol/api/0/route/${encodeURIComponent(callsign)}/${aircraft.lat}/${aircraft.lon}`);
    } catch {
      plannedRoute = null;
    }
  }

  return {
    provider: "adsblol",
    status: "airborne",
    lat: aircraft.lat,
    lon: aircraft.lon,
    altitude_ft: aircraft.alt_baro === "ground" ? 0 : aircraft.alt_baro,
    ground_speed_kts: aircraft.gs,
    heading: aircraft.track,
    planned_route: plannedRoute,
    raw: aircraft
  };
}

async function flightAwareLookup(flight) {
  const { start, end } = flightDateRange(flight);
  const ident = normalizeFlightIdent(flight.flight_number);
  const summary = await flightAwareFetch(`/flights/${encodeURIComponent(ident)}`, {
    ident_type: "designator",
    start,
    end,
    max_pages: 1
  });

  const flightInfo = chooseBestFlight(summary.flights || [], flight);
  if (!flightInfo) {
    return null;
  }

  let latestPosition = null;
  try {
    const track = await flightAwareFetch(`/flights/${encodeURIComponent(flightInfo.fa_flight_id)}/track`, {
      include_estimated_positions: true
    });
    latestPosition = normalizeFlightAwarePosition(track.positions?.at(-1));
  } catch (error) {
    latestPosition = null;
  }

  if (!latestPosition) {
    latestPosition = normalizeFlightAwarePosition(flightInfo.last_position);
  }

  let fallbackProvider = null;
  let fallbackPosition = null;

  if (!latestPosition) {
    try {
      const adsb = await adsbLolLookup(flight);
      if (adsb) {
        fallbackProvider = "flightaware_adsblol_position";
        fallbackPosition = {
          lat: adsb.lat,
          lon: adsb.lon,
          altitude_ft: adsb.altitude_ft,
          ground_speed_kts: adsb.ground_speed_kts,
          heading: adsb.heading,
          raw: adsb.raw
        };
      }
    } catch {
      fallbackPosition = null;
    }
  }

  const live = {
    provider: latestPosition ? "flightaware" : "flightaware_no_position",
    status: normalizeFlightAwareStatus(flightInfo),
    lat: latestPosition?.lat ?? null,
    lon: latestPosition?.lon ?? null,
    altitude_ft: latestPosition?.altitude_ft ?? null,
    ground_speed_kts: latestPosition?.ground_speed_kts ?? null,
    heading: latestPosition?.heading ?? null,
    scheduled_departure: flightInfo.scheduled_out || flightInfo.scheduled_off || null,
    scheduled_arrival: flightInfo.scheduled_in || flightInfo.scheduled_on || null,
    estimated_arrival: flightInfo.estimated_in || flightInfo.estimated_on || null,
    actual_departure: flightInfo.actual_out || flightInfo.actual_off || null,
    actual_arrival: flightInfo.actual_in || flightInfo.actual_on || null,
    gate_origin: flightInfo.gate_origin || null,
    gate_destination: flightInfo.gate_destination || null,
    terminal_origin: flightInfo.terminal_origin || null,
    terminal_destination: flightInfo.terminal_destination || null,
    departure_delay_seconds: flightInfo.departure_delay ?? null,
    arrival_delay_seconds: flightInfo.arrival_delay ?? null,
    raw: { flight: flightInfo, position: latestPosition, source: "flightaware_aeroapi" }
  };

  if (!latestPosition && fallbackPosition) {
    return mergeFallbackPosition(live, fallbackPosition, fallbackProvider);
  }

  if (!latestPosition) {
    return mergeFallbackPosition(live, demoRoute(flight), "flightaware_demo_position");
  }

  return live;
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
    if (provider === "flightaware") {
      return await flightAwareLookup(flight);
    }
    if (provider === "fr24") {
      return { ...demoRoute(flight), provider, status: "needs_provider_key" };
    }
    return demoRoute(flight);
  } catch (error) {
    return { ...demoRoute(flight), provider: "demo_fallback", raw: { providerError: error.message } };
  }
}
