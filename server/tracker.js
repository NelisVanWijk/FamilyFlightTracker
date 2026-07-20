import { lookupFlight } from "./providers.js";
import { query } from "./db.js";

export async function updateTrackedFlight(flight) {
  const live = await lookupFlight(flight);

  if (!live || live.lat == null || live.lon == null) {
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
      live.raw?.flight?.fa_flight_id || null,
      live.planned_route || null
    ]
  );

  await query(
    `insert into flight_positions
      (tracked_flight_id, lat, lon, altitude_ft, ground_speed_kts, heading, source, raw)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [flight.id, live.lat, live.lon, live.altitude_ft, live.ground_speed_kts, live.heading, live.provider, live.raw || {}]
  );

  return live;
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
