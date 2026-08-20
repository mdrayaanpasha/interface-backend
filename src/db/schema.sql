-- Supply Chain Risk & Route Advisor schema

CREATE TABLE IF NOT EXISTS shipments (
  id          SERIAL PRIMARY KEY,
  origin      TEXT    NOT NULL,
  dest        TEXT    NOT NULL,
  cargo       TEXT    NOT NULL,
  budget      NUMERIC,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS routes (
  id           SERIAL PRIMARY KEY,
  shipment_id  INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  waypoints    JSONB   NOT NULL DEFAULT '[]'::jsonb,
  cost         NUMERIC,
  carbon       NUMERIC,
  recommended  BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_routes_shipment ON routes(shipment_id);

-- Users, saved routes, and per-refresh history for the profile feature.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Profile fields (idempotent — safe to re-run against an existing table).
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_name      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_industry  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_country   TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_seed   TEXT;

CREATE TABLE IF NOT EXISTS saved_routes (
  id                 SERIAL PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  origin             TEXT NOT NULL,
  dest               TEXT NOT NULL,
  cargo              TEXT NOT NULL,
  budget             NUMERIC,
  -- denormalized current snapshot for fast list rendering
  current_risk       TEXT,
  current_score      INTEGER,
  last_refreshed_at  TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS route_states (
  id             SERIAL PRIMARY KEY,
  saved_route_id INTEGER NOT NULL REFERENCES saved_routes(id) ON DELETE CASCADE,
  overall_risk   TEXT,
  overall_score  INTEGER,
  result         JSONB NOT NULL,   -- full analyzeShipment() output snapshot
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_routes_user ON saved_routes(user_id);
CREATE INDEX IF NOT EXISTS idx_route_states_route ON route_states(saved_route_id, created_at DESC);
