-- market-data schema (for live persistence; mock core uses memory)
CREATE TABLE IF NOT EXISTS watchlist_symbols (
  tenant_id UUID NOT NULL,
  symbol TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, symbol)
);

CREATE TABLE IF NOT EXISTS price_quotes (
  tenant_id UUID NOT NULL,
  symbol TEXT NOT NULL,
  price NUMERIC NOT NULL,
  bid NUMERIC,
  ask NUMERIC,
  volume BIGINT,
  ts TIMESTAMPTZ NOT NULL,
  provider TEXT,
  PRIMARY KEY (tenant_id, symbol)
);

CREATE TABLE IF NOT EXISTS price_bars (
  tenant_id UUID NOT NULL,
  symbol TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  open NUMERIC NOT NULL,
  high NUMERIC NOT NULL,
  low NUMERIC NOT NULL,
  close NUMERIC NOT NULL,
  volume BIGINT NOT NULL,
  granularity TEXT NOT NULL,
  PRIMARY KEY (tenant_id, symbol, ts, granularity)
);

CREATE INDEX IF NOT EXISTS idx_price_bars_symbol_ts
  ON price_bars (tenant_id, symbol, granularity, ts);
