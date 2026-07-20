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
      live.estimated_arrival || null
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
