ALTER TABLE fisheries_shipments
  ADD COLUMN IF NOT EXISTS condition_code VARCHAR(20) NOT NULL DEFAULT 'whole'
    CHECK (condition_code IN ('whole', 'dressed', 'headed_gutted', 'gutted', 'other')),
  ADD COLUMN IF NOT EXISTS round_weight_kg NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS conversion_factor NUMERIC(6,4);

ALTER TABLE fisheries_processing_batches
  ADD COLUMN IF NOT EXISTS finished_condition_code VARCHAR(20) NOT NULL DEFAULT 'whole'
    CHECK (finished_condition_code IN ('whole', 'dressed', 'headed_gutted', 'gutted', 'other')),
  ADD COLUMN IF NOT EXISTS finished_round_weight_kg NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS finished_conversion_factor NUMERIC(6,4);
