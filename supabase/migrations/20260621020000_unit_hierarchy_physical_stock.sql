-- ============================================================
-- Migration: Unit Hierarchy + Physical Stock + Sale Line Snapshots
-- Date: 2026-06-21
-- ============================================================

-- ========================
-- 1. pharmacy_item_units — hierarchy support
-- ========================
ALTER TABLE pharmacy_item_units
  ADD COLUMN IF NOT EXISTS position INTEGER,         -- 1=tertiary, 2=secondary, 3=primary
  ADD COLUMN IF NOT EXISTS parent_unit_id UUID REFERENCES pharmacy_item_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conversion_to_lowest NUMERIC(14,3) DEFAULT 1 NOT NULL,
  ADD COLUMN IF NOT EXISTS old_sell_price NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS sale_enabled BOOLEAN DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS purchase_enabled BOOLEAN DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS unit_code TEXT;

COMMENT ON COLUMN pharmacy_item_units.position IS '1=tertiary (lowest), 2=secondary, 3=primary (highest)';
COMMENT ON COLUMN pharmacy_item_units.conversion_to_lowest IS 'How many of the lowest unit equal 1 of this unit';
COMMENT ON COLUMN pharmacy_item_units.old_sell_price IS 'Previous selling price for this unit level';
COMMENT ON COLUMN pharmacy_item_units.parent_unit_id IS 'Direct parent unit (e.g. strip is child of box)';

-- Set position defaults: is_base = position 1 (lowest), non-base = position 3 (highest)
UPDATE pharmacy_item_units
SET position = CASE WHEN is_base THEN 1 ELSE 3 END
WHERE position IS NULL;

-- Set conversion_to_lowest defaults
UPDATE pharmacy_item_units
SET conversion_to_lowest = COALESCE(factor, 1)
WHERE conversion_to_lowest = 1 AND position IS NOT NULL;

ALTER TABLE pharmacy_item_units ALTER COLUMN position SET NOT NULL;
ALTER TABLE pharmacy_item_units ALTER COLUMN conversion_to_lowest SET NOT NULL;

-- ========================
-- 2. pharmacy_item_stock_state — physical stock per batch
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_item_stock_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES pharmacy_branches(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES pharmacy_item_batches(id) ON DELETE CASCADE,
  sealed_primary_count NUMERIC(14,3) DEFAULT 0 NOT NULL,
  opened_primary_containers NUMERIC(14,3) DEFAULT 0 NOT NULL,
  full_secondary_count NUMERIC(14,3) DEFAULT 0 NOT NULL,
  opened_secondary_containers NUMERIC(14,3) DEFAULT 0 NOT NULL,
  loose_tertiary_count NUMERIC(14,3) DEFAULT 0 NOT NULL,
  base_equivalent_quantity NUMERIC(14,3) DEFAULT 0 NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pharmacy_id, branch_id, item_id, batch_id)
);

COMMENT ON TABLE pharmacy_item_stock_state IS 'Aggregated physical stock state per batch — tracks sealed/opened containers at each unit level';
COMMENT ON COLUMN pharmacy_item_stock_state.sealed_primary_count IS 'Number of sealed primary containers (e.g. sealed boxes)';
COMMENT ON COLUMN pharmacy_item_stock_state.opened_primary_containers IS 'Number of opened primary containers';
COMMENT ON COLUMN pharmacy_item_stock_state.full_secondary_count IS 'Full secondary units inside opened primaries (e.g. full strips)';
COMMENT ON COLUMN pharmacy_item_stock_state.opened_secondary_containers IS 'Opened secondary containers';
COMMENT ON COLUMN pharmacy_item_stock_state.loose_tertiary_count IS 'Loose tertiary units (e.g. individual pills)';
COMMENT ON COLUMN pharmacy_item_stock_state.base_equivalent_quantity IS 'Accounting cache — total in lowest unit';
COMMENT ON COLUMN pharmacy_item_stock_state.version IS 'Optimistic concurrency version';

CREATE INDEX IF NOT EXISTS idx_stock_state_lookup
  ON pharmacy_item_stock_state(pharmacy_id, branch_id, item_id);

-- ========================
-- 3. pharmacy_sale_lines — snapshot + unit fields
-- ========================
ALTER TABLE pharmacy_sale_lines
  ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES pharmacy_item_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS unit_level TEXT,
  ADD COLUMN IF NOT EXISTS conversion_to_base NUMERIC(14,3) DEFAULT 1 NOT NULL,
  ADD COLUMN IF NOT EXISTS base_quantity_deducted NUMERIC(14,3) DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS old_unit_price NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(8,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_amount NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profit_amount NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batch_allocations JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN pharmacy_sale_lines.unit_id IS 'Which unit level was sold';
COMMENT ON COLUMN pharmacy_sale_lines.unit_name_snapshot IS 'Unit name frozen at sale time';
COMMENT ON COLUMN pharmacy_sale_lines.unit_level IS 'primary/secondary/tertiary';
COMMENT ON COLUMN pharmacy_sale_lines.conversion_to_base IS 'Conversion factor frozen at sale time';
COMMENT ON COLUMN pharmacy_sale_lines.base_quantity_deducted IS 'Quantity deducted in lowest unit';
COMMENT ON COLUMN pharmacy_sale_lines.old_unit_price IS 'Previous price at time of sale';
COMMENT ON COLUMN pharmacy_sale_lines.batch_allocations IS '[{batchId, batchNumber, qty, cost}] from FEFO';

-- ========================
-- 4. pharmacy_sales — versioning / idempotency
-- ========================
ALTER TABLE pharmacy_sales
  ADD COLUMN IF NOT EXISTS device_id TEXT,
  ADD COLUMN IF NOT EXISTS local_sequence BIGINT;

-- ========================
-- 5. pharmacy_item_batches — cost per unit tracking
-- ========================
ALTER TABLE pharmacy_item_batches
  ADD COLUMN IF NOT EXISTS cost_per_lowest_unit NUMERIC(14,6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_lowest_units NUMERIC(14,3) DEFAULT 0;

-- ========================
-- 6. Constraints
-- ========================
ALTER TABLE pharmacy_sale_lines DROP CONSTRAINT IF EXISTS pharmacy_sale_lines_unit_level_check;
ALTER TABLE pharmacy_sale_lines ADD CONSTRAINT pharmacy_sale_lines_unit_level_check
  CHECK (unit_level IS NULL OR unit_level IN ('primary', 'secondary', 'tertiary'));

-- ========================
-- 7. View: physical stock display
-- ========================
CREATE OR REPLACE VIEW pharmacy_stock_display AS
SELECT
  s.pharmacy_id,
  s.branch_id,
  s.item_id,
  i.name_ar AS item_name,
  i.sku,
  s.batch_id,
  b.batch_number,
  b.expiry_date,
  s.sealed_primary_count,
  s.opened_primary_containers,
  s.full_secondary_count,
  s.opened_secondary_containers,
  s.loose_tertiary_count,
  s.base_equivalent_quantity,
  s.version,
  s.updated_at
FROM pharmacy_item_stock_state s
JOIN pharmacy_items i ON i.id = s.item_id
LEFT JOIN pharmacy_item_batches b ON b.id = s.batch_id;

-- ========================
-- 8. Function: reconcile accounting stock from physical
-- ========================
CREATE OR REPLACE FUNCTION reconcile_item_accounting_stock(
  p_pharmacy_id UUID,
  p_branch_id UUID,
  p_item_id UUID
) RETURNS NUMERIC(14,3) AS $$
DECLARE
  v_total NUMERIC(14,3);
BEGIN
  SELECT COALESCE(SUM(base_equivalent_quantity), 0)
  INTO v_total
  FROM pharmacy_item_stock_state
  WHERE pharmacy_id = p_pharmacy_id
    AND branch_id = p_branch_id
    AND item_id = p_item_id;

  RETURN v_total;
END;
$$ LANGUAGE plpgsql;

-- ========================
-- 9. Audit triggers for stock state changes
-- ========================
CREATE OR REPLACE FUNCTION log_stock_state_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO pharmacy_stock_movements (
      pharmacy_id, branch_id, item_id, batch_id,
      direction, quantity, movement_type, source_table, source_id,
      created_by, created_at
    )
    SELECT
      NEW.pharmacy_id, NEW.branch_id, NEW.item_id, NEW.batch_id,
      CASE
        WHEN NEW.base_equivalent_quantity > OLD.base_equivalent_quantity THEN 'in'
        WHEN NEW.base_equivalent_quantity < OLD.base_equivalent_quantity THEN 'out'
        ELSE 'adjust'
      END,
      ABS(NEW.base_equivalent_quantity - OLD.base_equivalent_quantity),
      'stock_state_reconcile', TG_TABLE_NAME, NEW.id,
      NULL, now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_state_change ON pharmacy_item_stock_state;
CREATE TRIGGER trg_stock_state_change
  AFTER UPDATE ON pharmacy_item_stock_state
  FOR EACH ROW
  WHEN (OLD.base_equivalent_quantity IS DISTINCT FROM NEW.base_equivalent_quantity)
  EXECUTE FUNCTION log_stock_state_change();
