# Supply Risk Backend

Node.js + Express API for the supply-chain risk and route analysis application. It resolves shipment locations, gathers live weather/news context, scores route risk with a local Ollama model, and supports user auth plus saved-route tracking.

## Overview

This backend powers:

- ad-hoc shipment analysis via `POST /api/analyze`
- auth endpoints for signup/login/profile
- saved route persistence and refresh history
- PostgreSQL-backed data storage
- scheduled refreshes for saved routes
- optional served frontend build when present

## Tech Stack

- Node.js 18+
- Express
- PostgreSQL via `pg`
- JWT auth with `jsonwebtoken`
- Bcrypt password hashing
- Node cron for scheduled route refreshes
- Ollama local LLM integration

## Prerequisites

Before starting the backend, make sure you have:

- PostgreSQL running locally
- Ollama installed and running
- the model pulled locally:

```bash
ollama pull qwen2.5-coder-16k:latest
```

## Environment Setup

Copy the example env file and adjust values as needed:

```bash
cp .env.example .env
```

Example values:

```env
DATABASE_URL=postgres://your_user@localhost:5432/supply_risk
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5-coder-16k:latest
PORT=8000
JWT_SECRET=change-me
AISSTREAM_KEY=
```

## Database

Create the database if it does not exist:

```bash
createdb supply_risk
```

Initialize the schema:

```bash
npm install
npm run initdb
```

## Run the API

Development mode:

```bash
npm install
npm run dev
```

Production-style start:

```bash
npm start
```

The server runs on `http://localhost:8000` by default.

## Health Check

```bash
curl http://localhost:8000/api/health
```

Expected response:

```json
{ "status": "ok", "db": "ok", "model": "qwen2.5-coder-16k:latest" }
```

## Main API Endpoints

### Analyze a shipment

```http
POST /api/analyze
```

Body:

```json
{
  "origin": "Shanghai",
  "dest": "Rotterdam",
  "cargo": "electronics",
  "budget": 50000
}
```

Returns risk scoring, recommended routes, and route metadata.

### Auth

```http
POST /api/auth/signup
POST /api/auth/login
GET /api/auth/me
PUT /api/auth/profile
```

### Saved routes

```http
POST /api/routes
GET /api/routes
GET /api/routes/:id
POST /api/routes/:id/refresh
DELETE /api/routes/:id
```

## Notes

- The server serves the built frontend from `../frontend/dist` if the frontend build exists.
- The app uses local curated risk data from `src/data/` and live APIs for weather/news.
- If no AIS key is configured, the AIS enrichment is skipped gracefully.
- The cron job can be tuned with `CRON_SCHEDULE` for scheduled route refreshes.

## Project Structure

```text
backend/
  src/
    agents/
    auth/
    data/
    db/
    jobs/
    routes/
    services/
    server.js
  .env.example
  package.json
```
