import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

const sqlitePath = process.env.SQLITE_PATH || "/data/family-flight-tracker.sqlite";
const sqliteDir = path.dirname(sqlitePath);

if (sqliteDir && sqliteDir !== "." && sqliteDir !== ":memory:") {
  fs.mkdirSync(sqliteDir, { recursive: true });
}

const db = new DatabaseSync(sqlitePath);
db.exec("pragma foreign_keys = on");
db.exec("pragma journal_mode = wal");

function toSqlite(sql, params) {
  const orderedParams = [];
  const reorderedText = sql.replace(/\$(\d+)/g, (_match, index) => {
    orderedParams.push(params[Number(index) - 1]);
    return "?";
  });

  return {
    sql: reorderedText
      .replace(/now\(\)/gi, "datetime('now')")
      .replace(/count\(\*\)::int/gi, "count(*)"),
    params: orderedParams.length ? orderedParams : params
  };
}

function bindValue(value) {
  if (value === undefined) {
    return null;
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return value;
}

function normalizeRow(row) {
  if (!row) {
    return row;
  }
  for (const field of ["last_lat", "last_lon", "last_altitude_ft", "last_ground_speed_kts", "last_heading"]) {
    if (row[field] !== null && row[field] !== undefined) {
      row[field] = Number(row[field]);
    }
  }
  return row;
}

export async function migrate() {
  db.exec(`
    create table if not exists users (
      id text primary key default (lower(hex(randomblob(16)))),
      email text unique not null,
      name text not null,
      password_hash text not null,
      role text not null default 'member',
      created_at text not null default (datetime('now'))
    );

    create table if not exists tracked_flights (
      id text primary key default (lower(hex(randomblob(16)))),
      user_id text not null references users(id) on delete cascade,
      passenger_name text not null,
      flight_number text not null,
      flight_date text not null,
      origin_iata text,
      destination_iata text,
      airline text,
      aircraft text,
      status text not null default 'planned',
      provider text not null default 'demo',
      provider_ref text,
      notes text,
      last_lat real,
      last_lon real,
      last_altitude_ft real,
      last_ground_speed_kts real,
      last_heading real,
      scheduled_departure text,
      scheduled_arrival text,
      estimated_arrival text,
      gate_origin text,
      gate_destination text,
      terminal_origin text,
      terminal_destination text,
      departure_delay_seconds integer,
      arrival_delay_seconds integer,
      actual_departure text,
      actual_arrival text,
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now'))
    );

    create table if not exists flight_positions (
      id integer primary key autoincrement,
      tracked_flight_id text not null references tracked_flights(id) on delete cascade,
      captured_at text not null default (datetime('now')),
      lat real not null,
      lon real not null,
      altitude_ft real,
      ground_speed_kts real,
      heading real,
      source text not null,
      raw text
    );

    create table if not exists flight_events (
      id integer primary key autoincrement,
      tracked_flight_id text not null references tracked_flights(id) on delete cascade,
      created_at text not null default (datetime('now')),
      event_type text not null,
      message text not null,
      raw text
    );
  `);

  for (const statement of [
    "alter table tracked_flights add column gate_origin text",
    "alter table tracked_flights add column gate_destination text",
    "alter table tracked_flights add column terminal_origin text",
    "alter table tracked_flights add column terminal_destination text",
    "alter table tracked_flights add column departure_delay_seconds integer",
    "alter table tracked_flights add column arrival_delay_seconds integer",
    "alter table tracked_flights add column actual_departure text",
    "alter table tracked_flights add column actual_arrival text"
  ]) {
    try {
      db.exec(statement);
    } catch (error) {
      if (!String(error.message).includes("duplicate column name")) {
        throw error;
      }
    }
  }
}

export async function query(sql, params = []) {
  const normalized = toSqlite(sql, params);
  const normalizedSql = normalized.sql;
  const normalizedParams = normalized.params.map(bindValue);
  const statement = db.prepare(normalizedSql);
  const lower = normalizedSql.trim().toLowerCase();

  if (lower.startsWith("select") || lower.includes(" returning ")) {
    const rows = statement.all(...normalizedParams).map(normalizeRow);
    return { rows };
  }

  const result = statement.run(...normalizedParams);
  return { rows: [], rowCount: result.changes };
}

export async function getFlightsForUser(userId) {
  const flights = db.prepare(`
    select *
    from tracked_flights
    where user_id = ?
    order by created_at desc
  `).all(userId).map(normalizeRow);

  const positionsStatement = db.prepare(`
    select captured_at, lat, lon, altitude_ft, ground_speed_kts, heading, source
    from flight_positions
    where tracked_flight_id = ?
    order by captured_at desc
    limit 80
  `);

  return flights.map((flight) => ({
    ...flight,
    positions: positionsStatement.all(flight.id).reverse()
  }));
}
