# Family Flight Tracker

Self-hosted Docker app om familievluchten te volgen, live posities op een kaart te tonen en je vluchtgeschiedenis in Postgres te bewaren.

## Features

- Login en registratie met JWT.
- Vluchten koppelen aan een familielid.
- Live kaart met MapLibre en OpenStreetMap tiles.
- Automatisch opslaan van positiepunten en events.
- Docker Compose met app en Postgres.
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

Handmatig draaien kan met een bestaande Postgres database:

```powershell
docker run -p 8080:8080 `
  -e DATABASE_URL="postgres://flights:flights@host.docker.internal:5432/flights" `
  -e JWT_SECRET="maak-hier-een-lange-random-secret" `
  -e ADMIN_EMAIL="admin@example.com" `
  -e ADMIN_PASSWORD="maak-hier-een-admin-wachtwoord" `
  -e FLIGHT_PROVIDER="flightaware" `
  -e FLIGHTAWARE_API_KEY="jouw-flightaware-aeroapi-key" `
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

Let op: een Unraid template beschrijft normaal één container. Maak daarom apart een Postgres-container aan, bijvoorbeeld met hostnaam `family-flight-postgres`, database `flights`, gebruiker `flights` en wachtwoord `flights`, of pas `DATABASE_URL` aan naar jouw eigen database.

Vul in de template minimaal deze velden in:

- `DATABASE_URL`: connectiestring naar Postgres.
- `JWT_SECRET`: lange willekeurige waarde.
- `ADMIN_EMAIL`: e-mailadres voor het eerste admin-account.
- `ADMIN_PASSWORD`: wachtwoord voor het eerste admin-account.
- `FLIGHTAWARE_API_KEY`: je AeroAPI key.

## Live databron instellen

In `.env` kun je de provider kiezen:

```env
FLIGHT_PROVIDER=flightaware
```

Beschikbare opties:

- `demo`: gesimuleerde live posities, handig voor testen.
- `opensky`: zoekt live states via OpenSky op callsign.
- `adsblol`: zoekt live ADS-B data via callsign.
- `flightaware`: gebruikt FlightAware AeroAPI voor vluchtstatus, tijden, gates, delays en trackposities. Als FlightAware geen positie teruggeeft, gebruikt de app ADSB.lol of demo als kaartpositie-fallback.
- `fr24`: placeholder voor Flightradar24 API integratie.

Daarna opnieuw starten:

```powershell
docker compose up --build
```

## Ontwikkelen zonder Docker

Je hebt lokaal Node.js en Postgres nodig.

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

## Productie-notities

- Zet `JWT_SECRET` in `.env` op een lange willekeurige waarde.
- Zet de app achter HTTPS, bijvoorbeeld via Caddy, Traefik of Nginx Proxy Manager.
- Gebruik voor betrouwbare vluchtstatus, gates, vertragingen en ETA's een commerciele API zoals FlightAware AeroAPI of FR24 API.
