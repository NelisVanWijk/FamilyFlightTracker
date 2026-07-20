import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { CalendarDays, Gauge, LogOut, Navigation, Plane, Plus, RefreshCcw, Route, ShieldCheck, Trash2, User } from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import { FlightMap } from "./components/FlightMap.jsx";
import { api } from "./lib/api.js";
import { formatHeading, formatKmhFromKnots, formatLocalDate, formatMetersFromFeet, formatMetersPerMinuteFromFeet } from "./lib/format.js";

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      const result = mode === "login"
        ? await api.login(form.email, form.password)
        : await api.register(form.name, form.email, form.password);
      onAuth(result);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="brand">
          <Plane size={34} />
          <div>
            <h1>Family Flight Tracker</h1>
            <p>Prive vluchtmonitor met kaart, login en historie.</p>
          </div>
        </div>

        <div className="mode-switch">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Inloggen</button>
          <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Account maken</button>
        </div>

        <form onSubmit={submit} className="auth-form">
          {mode === "register" && (
            <label>
              Naam
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
            </label>
          )}
          <label>
            E-mail
            <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
          </label>
          <label>
            Wachtwoord
            <input type="password" minLength={8} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primary" type="submit">
            <ShieldCheck size={18} />
            {mode === "login" ? "Inloggen" : "Account maken"}
          </button>
        </form>
      </section>
    </main>
  );
}

function FlightForm({ onCreate }) {
  const today = formatLocalDate();
  const [form, setForm] = useState({
    passenger_name: "",
    flight_number: "",
    flight_date: today,
    origin_iata: "AMS",
    destination_iata: "BCN",
    airline: "",
    aircraft: "",
    notes: ""
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onCreate(form);
      setForm((current) => ({ ...current, passenger_name: "", flight_number: "", notes: "" }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flight-form" onSubmit={submit}>
      <div className="form-grid">
        <label>
          Familielid
          <input value={form.passenger_name} onChange={(event) => update("passenger_name", event.target.value)} placeholder="Bijv. Mama" required />
        </label>
        <label>
          Vluchtnummer
          <input value={form.flight_number} onChange={(event) => update("flight_number", event.target.value)} placeholder="KL1234" required />
        </label>
        <label>
          Datum
          <input type="date" value={form.flight_date} onChange={(event) => update("flight_date", event.target.value)} required />
        </label>
        <label>
          Van
          <input maxLength={3} value={form.origin_iata} onChange={(event) => update("origin_iata", event.target.value.toUpperCase())} />
        </label>
        <label>
          Naar
          <input maxLength={3} value={form.destination_iata} onChange={(event) => update("destination_iata", event.target.value.toUpperCase())} />
        </label>
        <label>
          Airline
          <input value={form.airline} onChange={(event) => update("airline", event.target.value)} placeholder="Optioneel" />
        </label>
      </div>
      <label>
        Notities
        <textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Terminal, boekingsinfo, ophalen..." />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="primary" type="submit" disabled={busy}>
        <Plus size={18} />
        Vlucht volgen
      </button>
    </form>
  );
}

function FlightList({ flights, selectedId, onSelect, onRefresh, onArchive, onDelete }) {
  return (
    <div className="flight-list">
      {flights.length === 0 && (
        <div className="empty">
          <Route size={32} />
          <p>Voeg een vlucht toe om live tracking en historie te starten.</p>
        </div>
      )}
      {flights.map((flight) => (
        <FlightCard
          key={flight.id}
          flight={flight}
          selected={selectedId === flight.id}
          onSelect={onSelect}
          onRefresh={onRefresh}
          onArchive={onArchive}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function FlightCard({ flight, selected, onSelect, onRefresh, onArchive, onDelete }) {
  const raw = flight.latest_position_raw || {};

  return (
        <article
          className={`flight-card ${selected ? "selected" : ""}`}
          onClick={() => onSelect(flight.id)}
        >
          <div className="flight-card-top">
            <div>
              <strong>{flight.flight_number}</strong>
              <span>{flight.passenger_name}</span>
            </div>
            <span className={`status ${flight.status}`}>{flight.status}</span>
          </div>
          <div className="route-line">
            <span>{flight.origin_iata || "???"}</span>
            <Plane size={16} />
            <span>{flight.destination_iata || "???"}</span>
          </div>
          <div className="metrics">
            <span><Gauge size={14} /> {formatMetersFromFeet(flight.last_altitude_ft)}</span>
            <span>{formatKmhFromKnots(flight.last_ground_speed_kts)}</span>
            <span><Navigation size={14} /> {formatHeading(flight.last_heading)}</span>
          </div>
          <div className="adsb-details">
            <span>{raw.r || "geen registratie"}</span>
            <span>{raw.t || "geen type"}</span>
            <span>VS {formatMetersPerMinuteFromFeet(raw.baro_rate)}</span>
            <span>{flight.provider}</span>
          </div>
          <div className="card-actions">
            <button type="button" onClick={(event) => { event.stopPropagation(); onRefresh(flight.id); }} title="Vernieuwen">
              <RefreshCcw size={16} />
            </button>
            <button type="button" onClick={(event) => { event.stopPropagation(); onArchive(flight.id); }}>
              Archiveren
            </button>
            <button className="danger-button" type="button" onClick={(event) => { event.stopPropagation(); onDelete(flight); }} title="Verwijderen">
              <Trash2 size={16} />
            </button>
          </div>
        </article>
  );
}

function Dashboard({ auth, onLogout }) {
  const [flights, setFlights] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const selectedFlight = useMemo(
    () => flights.find((flight) => flight.id === selectedId) || flights[0],
    [flights, selectedId]
  );

  async function loadFlights() {
    setError("");
    try {
      const result = await api.flights(auth.token);
      setFlights(result.flights);
      if (!selectedId && result.flights[0]) {
        setSelectedId(result.flights[0].id);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFlights();
    const timer = setInterval(loadFlights, 5000);
    return () => clearInterval(timer);
  }, []);

  async function createFlight(flight) {
    await api.createFlight(auth.token, flight);
    await loadFlights();
  }

  async function refreshFlight(id) {
    await api.refreshFlight(auth.token, id);
    await loadFlights();
  }

  async function archiveFlight(id) {
    await api.archiveFlight(auth.token, id);
    await loadFlights();
  }

  async function deleteFlight(flight) {
    const confirmed = window.confirm(`Vlucht ${flight.flight_number} permanent verwijderen?`);
    if (!confirmed) return;
    await api.deleteFlight(auth.token, flight.id);
    if (selectedId === flight.id) {
      setSelectedId("");
    }
    await loadFlights();
  }

  const activeFlights = flights.filter((flight) => flight.status !== "archived");

  return (
    <main className="dashboard">
      <header className="topbar">
        <div className="brand compact">
          <Plane size={28} />
          <div>
            <h1>Family Flight Tracker</h1>
            <p>{activeFlights.length} actieve vlucht(en)</p>
          </div>
        </div>
        <div className="user-chip">
          <User size={16} />
          <span>{auth.user.name}</span>
          <button onClick={onLogout} title="Uitloggen">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <section className="layout">
        <aside className="sidebar">
          <div className="panel-title">
            <CalendarDays size={18} />
            <h2>Nieuwe vlucht</h2>
          </div>
          <FlightForm onCreate={createFlight} />
          <div className="panel-title">
            <Route size={18} />
            <h2>Vluchtgeschiedenis</h2>
          </div>
          {error && <p className="error">{error}</p>}
          {loading ? <p className="muted">Laden...</p> : (
            <FlightList
              flights={flights}
              selectedId={selectedFlight?.id}
              onSelect={setSelectedId}
              onRefresh={refreshFlight}
              onArchive={archiveFlight}
              onDelete={deleteFlight}
            />
          )}
        </aside>
        <section className="map-area">
          <FlightMap flights={activeFlights} selectedFlight={selectedFlight} onSelect={setSelectedId} />
        </section>
      </section>
    </main>
  );
}

function App() {
  const [auth, setAuth] = useState(() => {
    const raw = localStorage.getItem("fft-auth");
    return raw ? JSON.parse(raw) : null;
  });

  function onAuth(nextAuth) {
    localStorage.setItem("fft-auth", JSON.stringify(nextAuth));
    setAuth(nextAuth);
  }

  function logout() {
    localStorage.removeItem("fft-auth");
    setAuth(null);
  }

  return auth ? <Dashboard auth={auth} onLogout={logout} /> : <AuthScreen onAuth={onAuth} />;
}

createRoot(document.getElementById("root")).render(<App />);
