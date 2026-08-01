ALTER TABLE fisheries_shipments
  ADD COLUMN IF NOT EXISTS original_weight NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS original_unit VARCHAR(10) NOT NULL DEFAULT 'kg';

UPDATE fisheries_shipments
SET original_weight = weight_kg, original_unit = 'kg'
WHERE original_weight IS NULL;
