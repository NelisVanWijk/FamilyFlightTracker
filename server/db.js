import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://flights:flights@localhost:5432/flights"
});

export async function migrate() {
  await pool.query(`
    create extension if not exists "pgcrypto";

    create table if not exists users (
      id uuid primary key default gen_random_uuid(),
      email text unique not null,
      name text not null,
      password_hash text not null,
      role text not null default 'member',
      created_at timestamptz not null default now()
    );

    create table if not exists tracked_flights (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      passenger_name text not null,
      flight_number text not null,
      flight_date date not null,
      origin_iata text,
      destination_iata text,
      airline text,
      aircraft text,
      status text not null default 'planned',
      provider text not null default 'demo',
      provider_ref text,
      notes text,
      last_lat numeric,
      last_lon numeric,
      last_altitude_ft numeric,
      last_ground_speed_kts numeric,
      last_heading numeric,
      scheduled_departure timestamptz,
      scheduled_arrival timestamptz,
      estimated_arrival timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists flight_positions (
      id bigserial primary key,
      tracked_flight_id uuid not null references tracked_flights(id) on delete cascade,
      captured_at timestamptz not null default now(),
      lat numeric not null,
      lon numeric not null,
      altitude_ft numeric,
      ground_speed_kts numeric,
      heading numeric,
      source text not null,
      raw jsonb
    );

    create table if not exists flight_events (
      id bigserial primary key,
      tracked_flight_id uuid not null references tracked_flights(id) on delete cascade,
      created_at timestamptz not null default now(),
      event_type text not null,
      message text not null,
      raw jsonb
    );
  `);

  await pool.query(`
    alter table tracked_flights add column if not exists gate_origin text;
    alter table tracked_flights add column if not exists gate_destination text;
    alter table tracked_flights add column if not exists terminal_origin text;
    alter table tracked_flights add column if not exists terminal_destination text;
    alter table tracked_flights add column if not exists departure_delay_seconds integer;
    alter table tracked_flights add column if not exists arrival_delay_seconds integer;
    alter table tracked_flights add column if not exists actual_departure timestamptz;
    alter table tracked_flights add column if not exists actual_arrival timestamptz;
  `);
}

export async function query(sql, params = []) {
  return pool.query(sql, params);
}
