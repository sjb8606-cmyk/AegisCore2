CREATE TABLE IF NOT EXISTS tool_contracts (
  name TEXT PRIMARY KEY,
  risk_level INT NOT NULL,
  reversible BOOLEAN NOT NULL,
  external_impact BOOLEAN NOT NULL,
  requires_confirmation BOOLEAN NOT NULL,
  cost_estimate TEXT NOT NULL,
  input_schema JSONB NOT NULL DEFAULT '{}',
  output_schema JSONB NOT NULL DEFAULT '{}',
  description TEXT
);
