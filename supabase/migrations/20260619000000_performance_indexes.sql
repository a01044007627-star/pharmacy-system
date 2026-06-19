-- Performance indexes for pharmacy inventory operations

-- pharmacy_stock_movements: no indexes previously; this table is queried by
-- pharmacy_id + item_id (per-item history), pharmacy_id + branch_id (branch
-- filter), and pharmacy_id + movement_type + created_at (list view).
CREATE INDEX IF NOT EXISTS idx_stock_movements_pharmacy_item
  ON public.pharmacy_stock_movements(pharmacy_id, item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_pharmacy_branch
  ON public.pharmacy_stock_movements(pharmacy_id, branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_pharmacy_type
  ON public.pharmacy_stock_movements(pharmacy_id, movement_type, created_at DESC);

-- pharmacy_stock_balances: composite index for branch-filtered queries
-- (existing index is only pharmacy_id + item_id).
CREATE INDEX IF NOT EXISTS idx_stock_balances_branch
  ON public.pharmacy_stock_balances(pharmacy_id, branch_id, item_id);

-- pharmacy_item_batches: composite index for batch lookups by pharmacy+branch
-- (existing index is item_id + expiry_date only).
CREATE INDEX IF NOT EXISTS idx_item_batches_pharmacy_branch
  ON public.pharmacy_item_batches(pharmacy_id, branch_id, item_id);

-- pharmacy_item_barcodes: composite index for item-scoped barcode lookups
-- (existing index is barcode only).
CREATE INDEX IF NOT EXISTS idx_item_barcodes_pharmacy_item
  ON public.pharmacy_item_barcodes(pharmacy_id, item_id);

-- pharmacy_damaged_stock: no index exists; queried by pharmacy_id
CREATE INDEX IF NOT EXISTS idx_damaged_stock_pharmacy
  ON public.pharmacy_damaged_stock(pharmacy_id, created_at DESC);

-- pharmacy_item_units: index for sub-unit filter queries
CREATE INDEX IF NOT EXISTS idx_item_units_pharmacy_item
  ON public.pharmacy_item_units(pharmacy_id, item_id);
