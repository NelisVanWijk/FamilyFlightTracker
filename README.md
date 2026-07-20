# Family Flight Tracker

Self-hosted Docker app om familievluchten te volgen, live posities op een kaart te tonen en je vluchtgeschiedenis in SQLite te bewaren.

## Features

- Login en registratie met JWT.
- Vluchten koppelen aan een familielid.
- Live kaart met MapLibre en OpenStreetMap tiles.
- Automatisch opslaan van positiepunten en events in een lokale SQLite database.
- ADSB.lol trace-import voor de afgelegde route vanaf vertrek, voor zover de tar1090 trace beschikbaar is.
- Docker Compose met een app-container.
- Providerlaag voor `demo`, `opensky`, `adsblol`, `flightaware` en `fr24`.

## Snel starten

```powershell
cd E:\source\repos\FamilyFlightTracker
Copy-Item .env.example .env
docker compose up --build
```

Open daarna:

```text
http://localhost:8080
```

Maak je eerste account aan en voeg bijvoorbeeld deze demo-vlucht toe:

```text
Familielid: Niels
Vluchtnummer: KL1234
Van: AMS
Naar: BCN
```

Met `FLIGHT_PROVIDER=demo` beweegt de vlucht gesimuleerd over de kaart. Zo kun je de app direct testen zonder betaalde API.

## Docker image

Na elke push naar `main` bouwt GitHub Actions automatisch een image:

```text
ghcr.io/nelisvanwijk/family-flight-tracker:latest
```

Handmatig draaien met SQLite:

```powershell
docker run -p 8080:8080 `
  -v family-flight-tracker-data:/data `
  -e JWT_SECRET="maak-hier-een-lange-random-secret" `
  -e ADMIN_EMAIL="admin@example.com" `
  -e ADMIN_PASSWORD="maak-hier-een-admin-wachtwoord" `
  -e FLIGHT_PROVIDER="adsblol" `
  -e ADSBLOL_TRACE_IMPORT_INTERVAL_MINUTES="10" `
  -e ADSBLOL_TRACE_FALLBACK_MAX_AGE_MINUTES="45" `
  ghcr.io/nelisvanwijk/family-flight-tracker:latest
```

Bij de eerste start maakt de app automatisch een admin-account aan als `ADMIN_EMAIL` en `ADMIN_PASSWORD` zijn ingevuld. Daarna staat registratie standaard dicht. Zet `ALLOW_REGISTRATION=true` als familieleden zichzelf ook accounts mogen maken.

## Unraid template

De Unraid template staat in:

```text
unraid/family-flight-tracker.xml
```

Upload dit XML-bestand in Unraid via Docker templates of gebruik de raw URL nadat de repository op GitHub staat:

```text
https://raw.githubusercontent.com/NelisVanWijk/FamilyFlightTracker/main/unraid/family-flight-tracker.xml
```

De app gebruikt standaard SQLite. Je hoeft dus geen losse database-container aan te maken. Zorg alleen dat de template een vaste appdata-map naar `/data` mount, bijvoorbeeld `/mnt/user/appdata/family-flight-tracker`.

Vul in de template minimaal deze velden in:

- `App Data`: map op Unraid waar de SQLite database wordt opgeslagen.
- `JWT_SECRET`: lange willekeurige waarde.
- `ADMIN_EMAIL`: e-mailadres voor het eerste admin-account.
- `ADMIN_PASSWORD`: wachtwoord voor het eerste admin-account.
- `FLIGHT_PROVIDER`: laat op `adsblol` staan voor gratis ADS-B posities.
- `ADSBLOL_TRACE_IMPORT_INTERVAL_MINUTES`: laat op `10` staan om ontbrekende routepunten uit ADSB.lol traces bij te vullen.
- `ADSBLOL_TRACE_FALLBACK_MAX_AGE_MINUTES`: laat op `45` staan zodat recente tracepunten gebruikt mogen worden wanneer de live API tijdelijk niets teruggeeft.

## Live databron instellen

In `.env` kun je de provider kiezen:

```env
FLIGHT_PROVIDER=adsblol
```

Beschikbare opties:

- `demo`: gesimuleerde live posities, handig voor testen.
- `opensky`: zoekt live states via OpenSky op callsign.
- `adsblol`: zoekt gratis live ADS-B data via callsign. Aanbevolen standaard voor deze prive-app.
- `flightaware`: optioneel; gebruikt FlightAware AeroAPI voor vluchtstatus, tijden, gates, delays en trackposities. Let op: AeroAPI kan per query kosten.
- `fr24`: placeholder voor Flightradar24 API integratie.

Met `FLIGHT_PROVIDER=adsblol` haalt de app de live positie op via `api.adsb.lol` en importeert daarnaast periodiek de tar1090 trace-bestanden `trace_full` en `trace_recent`. Daardoor kan de kaart de afgelegde route vanaf vertrek tonen, ook als de app pas na vertrek is gestart. De import draait standaard eens per 10 minuten en is uit te zetten met:

```env
ADSBLOL_TRACE_IMPORT_INTERVAL_MINUTES=0
```

Daarna opnieuw starten:

```powershell
docker compose up --build
```

## Ontwikkelen zonder Docker

Je hebt lokaal Node.js nodig. SQLite zit ingebouwd in Node 24.

```powershell
npm install
npm run dev
```

Frontend draait dan via Vite op `http://localhost:5173`; API draait op `http://localhost:8080`.

## Data

Belangrijkste tabellen:

- `users`: accounts.
- `tracked_flights`: vluchtmetadata en laatste bekende status/positie.
- `flight_positions`: alle opgeslagen positiepunten.
- `flight_events`: provider events en missers.

Standaard databasepad in Docker:

```text
/data/family-flight-tracker.sqlite
```

## Productie-notities

- Zet `JWT_SECRET` in `.env` op een lange willekeurige waarde.
- Zet de app achter HTTPS, bijvoorbeeld via Caddy, Traefik of Nginx Proxy Manager.
- Gebruik voor betrouwbare vluchtstatus, gates, vertragingen en ETA's een commerciele API zoals FlightAware AeroAPI of FR24 API.
