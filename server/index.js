import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { createUser, ensureAdminUser, registrationAllowed, requireAuth, signUser, verifyLogin } from "./auth.js";
import { getFlightsForUser, migrate, query } from "./db.js";
import { updateActiveFlights, updateTrackedFlight } from "./tracker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.APP_PORT || 8080);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const flightSchema = z.object({
  passenger_name: z.string().min(2).max(100),
  flight_number: z.string().min(2).max(12).transform((value) => value.replace(/\s+/g, "").toUpperCase()),
  flight_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  origin_iata: z.string().length(3).transform((value) => value.toUpperCase()).optional().or(z.literal("")),
  destination_iata: z.string().length(3).transform((value) => value.toUpperCase()).optional().or(z.literal("")),
  airline: z.string().max(100).optional().or(z.literal("")),
  aircraft: z.string().max(100).optional().or(z.literal("")),
  notes: z.string().max(1000).optional().or(z.literal(""))
});

app.get("/api/health", async (_req, res) => {
  await query("select 1");
  res.json({ ok: true, provider: process.env.FLIGHT_PROVIDER || "demo" });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    if (!(await registrationAllowed())) {
      return res.status(403).json({ error: "Registratie is gesloten. Log in met het admin-account uit de template." });
    }
    const user = await createUser(req.body);
    res.status(201).json({ token: signUser(user), user });
  } catch (error) {
    if (error.code === "23505" || error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "Er bestaat al een account met dit e-mailadres." });
    }
    res.status(400).json({ error: "Registratie mislukt.", details: error.errors || error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const user = await verifyLogin(req.body);
  if (!user) {
    return res.status(401).json({ error: "E-mailadres of wachtwoord klopt niet." });
  }
  res.json({ token: signUser(user), user });
});

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/flights", requireAuth, async (req, res) => {
  const flights = await getFlightsForUser(req.user.id);
  res.json({ flights });
});

app.post("/api/flights", requireAuth, async (req, res) => {
  try {
    const flight = flightSchema.parse(req.body);
    const { rows } = await query(
      `insert into tracked_flights
       (user_id, passenger_name, flight_number, flight_date, origin_iata, destination_iata, airline, aircraft, notes, provider)
       values ($1, $2, $3, $4, nullif($5, ''), nullif($6, ''), nullif($7, ''), nullif($8, ''), nullif($9, ''), $10)
       returning *`,
      [
        req.user.id,
        flight.passenger_name,
        flight.flight_number,
        flight.flight_date,
        flight.origin_iata || "",
        flight.destination_iata || "",
        flight.airline || "",
        flight.aircraft || "",
        flight.notes || "",
        process.env.FLIGHT_PROVIDER || "demo"
      ]
    );
    await updateTrackedFlight(rows[0]);
    const fresh = await query("select * from tracked_flights where id = $1", [rows[0].id]);
    res.status(201).json({ flight: fresh.rows[0] });
  } catch (error) {
    res.status(400).json({ error: "Vlucht kon niet worden toegevoegd.", details: error.errors || error.message });
  }
});

app.post("/api/flights/:id/refresh", requireAuth, async (req, res) => {
  const { rows } = await query("select * from tracked_flights where id = $1 and user_id = $2", [req.params.id, req.user.id]);
  if (!rows[0]) {
    return res.status(404).json({ error: "Vlucht niet gevonden." });
  }
  const live = await updateTrackedFlight(rows[0]);
  const fresh = await query("select * from tracked_flights where id = $1", [req.params.id]);
  res.json({ flight: fresh.rows[0], live });
});

app.patch("/api/flights/:id/archive", requireAuth, async (req, res) => {
  const { rows } = await query(
    "update tracked_flights set status = 'archived', updated_at = now() where id = $1 and user_id = $2 returning *",
    [req.params.id, req.user.id]
  );
  if (!rows[0]) {
    return res.status(404).json({ error: "Vlucht niet gevonden." });
  }
  res.json({ flight: rows[0] });
});

const distPath = path.join(__dirname, "..", "dist");
app.use(express.static(distPath));
app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

await migrate();
await ensureAdminUser();
setInterval(() => updateActiveFlights().catch((error) => console.error("Tracker update mislukt", error)), 60_000);
updateActiveFlights().catch(() => {});

app.listen(port, () => {
  console.log(`Family Flight Tracker draait op http://localhost:${port}`);
});
