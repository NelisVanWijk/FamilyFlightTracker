import { lookupAdsbLolTracePoints, lookupFlight } from "./providers.js";
import { query } from "./db.js";

function parseDbTimestamp(value) {
  if (!value) {
    return null;
  }
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function shouldImportTrace(flight) {
  const provider = (process.env.FLIGHT_PROVIDER || "demo").toLowerCase();
  const intervalMinutes = Number(process.env.ADSBLOL_TRACE_IMPORT_INTERVAL_MINUTES || 10);
  if (provider !== "adsblol" || intervalMinutes <= 0) {
    return false;
  }

  const lastImportedAt = parseDbTimestamp(flight.trace_last_imported_at);
  return !lastImportedAt || Date.now() - lastImportedAt > intervalMinutes * 60 * 1000;
}

function sqliteTimestampFromSeconds(timestamp) {
  const date = new Date(timestamp * 1000);
  return date.toISOString().replace("T", " ").replace("Z", "");
}

function parseRaw(value) {
  if (!value || typeof value !== "string") {
    return value || null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeHex(value) {
  const hex = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{6}$/.test(hex) ? hex : null;
}

function tracePointIsRecent(point) {
  const maxAgeMinutes = Number(process.env.ADSBLOL_TRACE_FALLBACK_MAX_AGE_MINUTES || 45);
  if (!point || maxAgeMinutes <= 0) {
    return false;
  }
  return Date.now() / 1000 - point.timestamp <= maxAgeMinutes * 60;
}

async function findTraceHex(flight) {
  const providerRefHex = normalizeHex(flight.provider_ref);
  if (providerRefHex) {
    return providerRefHex;
  }

  const { rows } = await query(
    `select raw
     from flight_positions
     where tracked_flight_id = $1
       and raw is not null
     order by captured_at desc, id desc
     limit 20`,
    [flight.id]
  );

  for (const row of rows) {
    const raw = parseRaw(row.raw);
    const hex = normalizeHex(raw?.hex);
    if (hex) {
      return hex;
    }
  }

  return null;
}

async function importTracePositions(flightId, tracePoints = []) {
  let inserted = 0;

  for (const point of tracePoints) {
    const result = await query(
      `insert into flight_positions
        (tracked_flight_id, captured_at, lat, lon, altitude_ft, ground_speed_kts, heading, source, raw)
       select $1, $2, $3, $4, $5, $6, $7, $8, $9
       where not exists (
         select 1
         from flight_positions
         where tracked_flight_id = $1
           and captured_at = $2
           and source = $8
       )`,
      [
        flightId,
        sqliteTimestampFromSeconds(point.timestamp),
        point.lat,
        point.lon,
        point.altitude_ft,
        point.ground_speed_kts,
        point.heading,
        "adsblol_trace",
        point.raw || {}
      ]
    );
    inserted += result.rowCount;
  }

  return inserted;
}

async function updateFlightFromTracePoint(flightId, point) {
  await query(
    `update tracked_flights
     set status = 'airborne',
         provider = 'adsblol_trace',
         provider_ref = coalesce($2, provider_ref),
         last_lat = $3,
         last_lon = $4,
         last_altitude_ft = $5,
         last_ground_speed_kts = $6,
         last_heading = $7,
         updated_at = now()
     where id = $1`,
    [
      flightId,
      point.raw?.hex || null,
      point.lat,
      point.lon,
      point.altitude_ft,
      point.ground_speed_kts,
      point.heading
    ]
  );
}

async function importAvailableTrace(flight, live, options = {}) {
  const dueForFullImport = shouldImportTrace(flight);
  if (!dueForFullImport && !options.forceRecent) {
    return { attempted: false, imported: 0, latestPoint: null };
  }

  let traceAttempted = Boolean(live?.trace_attempted);
  let tracePoints = live?.trace_points || [];
  let traceError = null;

  if (!traceAttempted) {
    const hex = await findTraceHex(flight);
    if (hex) {
      traceAttempted = true;
      try {
        tracePoints = await lookupAdsbLolTracePoints(flight, hex, {
          recentOnly: !dueForFullImport
        });
      } catch (error) {
        traceError = error.message;
      }
    }
  }

  const latestPoint = tracePoints.at(-1) || null;
  const imported = await importTracePositions(flight.id, tracePoints);

  if (traceAttempted && dueForFullImport) {
    await query("update tracked_flights set trace_last_imported_at = now() where id = $1", [flight.id]);
  }

  if (imported > 0) {
    await query(
      `insert into flight_events (tracked_flight_id, event_type, message, raw)
       values ($1, 'trace_import', $2, $3)`,
      [
        flight.id,
        `${imported} historische ADSB positiepunten geimporteerd.`,
        { count: imported, source: "adsblol_trace", error: traceError }
      ]
    );
  }

  return { attempted: traceAttempted, imported, latestPoint, error: traceError };
}

export async function updateTrackedFlight(flight) {
  const live = await lookupFlight(flight, { includeTrace: shouldImportTrace(flight) });

  if (!live || live.lat == null || live.lon == null) {
    const traceImport = await importAvailableTrace(flight, live, { forceRecent: true });
    if (tracePointIsRecent(traceImport.latestPoint)) {
      await updateFlightFromTracePoint(flight.id, traceImport.latestPoint);
      return {
        provider: "adsblol_trace",
        status: "airborne",
        lat: traceImport.latestPoint.lat,
        lon: traceImport.latestPoint.lon,
        altitude_ft: traceImport.latestPoint.altitude_ft,
        ground_speed_kts: traceImport.latestPoint.ground_speed_kts,
        heading: traceImport.latestPoint.heading,
        trace_points_imported: traceImport.imported
      };
    }
    await query(
      `insert into flight_events (tracked_flight_id, event_type, message, raw)
       values ($1, 'lookup_miss', $2, $3)`,
      [flight.id, `Geen live positie gevonden voor ${flight.flight_number}.`, live || {}]
    );
    return null;
  }

  await query(
    `update tracked_flights
     set status = $2,
         provider = $3,
         last_lat = $4,
         last_lon = $5,
         last_altitude_ft = $6,
         last_ground_speed_kts = $7,
         last_heading = $8,
         estimated_arrival = coalesce($9, estimated_arrival),
         scheduled_departure = coalesce($10, scheduled_departure),
         scheduled_arrival = coalesce($11, scheduled_arrival),
         actual_departure = coalesce($12, actual_departure),
         actual_arrival = coalesce($13, actual_arrival),
         gate_origin = coalesce($14, gate_origin),
         gate_destination = coalesce($15, gate_destination),
         terminal_origin = coalesce($16, terminal_origin),
         terminal_destination = coalesce($17, terminal_destination),
         departure_delay_seconds = coalesce($18, departure_delay_seconds),
         arrival_delay_seconds = coalesce($19, arrival_delay_seconds),
         provider_ref = coalesce($20, provider_ref),
         planned_route_raw = coalesce($21, planned_route_raw),
         updated_at = now()
     where id = $1`,
    [
      flight.id,
      live.status || flight.status,
      live.provider,
      live.lat,
      live.lon,
      live.altitude_ft,
      live.ground_speed_kts,
      live.heading,
      live.estimated_arrival || null,
      live.scheduled_departure || null,
      live.scheduled_arrival || null,
      live.actual_departure || null,
      live.actual_arrival || null,
      live.gate_origin || null,
      live.gate_destination || null,
      live.terminal_origin || null,
      live.terminal_destination || null,
      live.departure_delay_seconds ?? null,
      live.arrival_delay_seconds ?? null,
      live.provider_ref || live.raw?.flight?.fa_flight_id || null,
      live.planned_route || null
    ]
  );

  const traceImport = await importAvailableTrace(flight, live);

  await query(
    `insert into flight_positions
      (tracked_flight_id, lat, lon, altitude_ft, ground_speed_kts, heading, source, raw)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [flight.id, live.lat, live.lon, live.altitude_ft, live.ground_speed_kts, live.heading, live.provider, live.raw || {}]
  );

  return { ...live, trace_points: undefined, trace_points_imported: traceImport.imported };
}

export async function updateActiveFlights() {
  const { rows } = await query(
    `select *
     from tracked_flights
     where status not in ('landed', 'cancelled', 'archived')
     order by updated_at asc
     limit 25`
  );

  for (const flight of rows) {
    await updateTrackedFlight(flight);
  }
}
