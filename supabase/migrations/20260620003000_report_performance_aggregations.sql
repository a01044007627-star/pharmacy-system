-- ===================================================================
-- Report performance aggregations
-- Server-side aggregation functions to speed up reports
-- ===================================================================

-- 1. Daily sales summary aggregation
CREATE OR REPLACE FUNCTION public.get_daily_sales_summary(
  p_pharmacy_id UUID,
  p_from_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_to_date DATE DEFAULT CURRENT_DATE,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE(
  sale_date DATE,
  invoice_count BIGINT,
  total_sales NUMERIC,
  total_discounts NUMERIC,
  total_tax NUMERIC,
  total_cost NUMERIC,
  total_profit NUMERIC,
  cash_sales NUMERIC,
  card_sales NUMERIC,
  credit_sales NUMERIC,
  item_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.sale_date::DATE,
    COUNT(DISTINCT s.id)::BIGINT AS invoice_count,
    COALESCE(SUM(s.total), 0) AS total_sales,
    COALESCE(SUM(s.discount_total), 0) AS total_discounts,
    COALESCE(SUM(s.tax_total), 0) AS total_tax,
    COALESCE(SUM(sl.purchase_price * sl.quantity), 0) AS total_cost,
    COALESCE(SUM(s.total - (sl.purchase_price * sl.quantity)), 0) AS total_profit,
    COALESCE(SUM(CASE WHEN s.payment_method = 'cash' THEN s.paid_amount ELSE 0 END), 0) AS cash_sales,
    COALESCE(SUM(CASE WHEN s.payment_method IN ('card', 'wallet', 'mixed') THEN s.paid_amount ELSE 0 END), 0) AS card_sales,
    COALESCE(SUM(CASE WHEN s.payment_method = 'credit' THEN s.total ELSE 0 END), 0) AS credit_sales,
    COALESCE(SUM(sl.quantity), 0)::BIGINT AS item_count
  FROM public.pharmacy_sales s
  LEFT JOIN public.pharmacy_sale_lines sl ON sl.sale_id = s.id AND sl.pharmacy_id = s.pharmacy_id
  WHERE s.pharmacy_id = p_pharmacy_id
    AND s.status NOT IN ('void', 'cancelled')
    AND s.sale_date::DATE >= p_from_date
    AND s.sale_date::DATE <= p_to_date
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
  GROUP BY s.sale_date::DATE
  ORDER BY s.sale_date::DATE DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_daily_sales_summary(UUID, DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_daily_sales_summary(UUID, DATE, DATE, UUID) TO authenticated;

-- 2. Top selling items
CREATE OR REPLACE FUNCTION public.get_top_selling_items(
  p_pharmacy_id UUID,
  p_from_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_to_date DATE DEFAULT CURRENT_DATE,
  p_limit INT DEFAULT 20,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE(
  item_id UUID,
  item_name TEXT,
  sku TEXT,
  total_quantity NUMERIC,
  total_sales NUMERIC,
  total_cost NUMERIC,
  total_profit NUMERIC,
  sale_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sl.item_id,
    COALESCE(i.name_ar, sl.item_name, '') AS item_name,
    i.sku,
    SUM(sl.quantity) AS total_quantity,
    SUM(sl.net_total) AS total_sales,
    SUM(sl.purchase_price * sl.quantity) AS total_cost,
    SUM(sl.net_total - (sl.purchase_price * sl.quantity)) AS total_profit,
    COUNT(DISTINCT s.id)::BIGINT AS sale_count
  FROM public.pharmacy_sale_lines sl
  JOIN public.pharmacy_sales s ON s.id = sl.sale_id AND s.pharmacy_id = sl.pharmacy_id
  LEFT JOIN public.pharmacy_items i ON i.id = sl.item_id AND i.pharmacy_id = sl.pharmacy_id
  WHERE sl.pharmacy_id = p_pharmacy_id
    AND s.status NOT IN ('void', 'cancelled')
    AND s.sale_date::DATE >= p_from_date
    AND s.sale_date::DATE <= p_to_date
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
  GROUP BY sl.item_id, i.name_ar, i.sku
  ORDER BY total_sales DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_top_selling_items(UUID, DATE, DATE, INT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_top_selling_items(UUID, DATE, DATE, INT, UUID) TO authenticated;

-- 3. Profit & loss summary
CREATE OR REPLACE FUNCTION public.get_profit_loss_summary(
  p_pharmacy_id UUID,
  p_from_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_to_date DATE DEFAULT CURRENT_DATE,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE(
  period_label TEXT,
  total_revenue NUMERIC,
  total_cost NUMERIC,
  gross_profit NUMERIC,
  gross_margin_percent NUMERIC,
  total_discounts NUMERIC,
  total_expenses NUMERIC,
  net_profit NUMERIC,
  invoice_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period TEXT;
BEGIN
  v_period := to_char(p_from_date, 'YYYY-MM') || ' to ' || to_char(p_to_date, 'YYYY-MM');

  RETURN QUERY
  WITH sales_data AS (
    SELECT
      COALESCE(SUM(s.total), 0) AS total_revenue,
      COALESCE(SUM(sl.purchase_price * sl.quantity), 0) AS total_cost,
      COALESCE(SUM(s.discount_total), 0) AS total_discounts,
      COUNT(DISTINCT s.id)::BIGINT AS invoice_count
    FROM public.pharmacy_sales s
    LEFT JOIN public.pharmacy_sale_lines sl ON sl.sale_id = s.id AND sl.pharmacy_id = s.pharmacy_id
    WHERE s.pharmacy_id = p_pharmacy_id
      AND s.status NOT IN ('void', 'cancelled')
      AND s.sale_date::DATE >= p_from_date
      AND s.sale_date::DATE <= p_to_date
      AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
  ),
  expense_data AS (
    SELECT COALESCE(SUM(amount), 0) AS total_expenses
    FROM public.pharmacy_financial_movements
    WHERE pharmacy_id = p_pharmacy_id
      AND direction = 'out'
      AND category = 'expense'
      AND movement_date::DATE >= p_from_date
      AND movement_date::DATE <= p_to_date
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
  )
  SELECT
    v_period AS period_label,
    sales_data.total_revenue,
    sales_data.total_cost,
    GREATEST(sales_data.total_revenue - sales_data.total_cost, 0) AS gross_profit,
    CASE WHEN sales_data.total_revenue > 0
      THEN ROUND((sales_data.total_revenue - sales_data.total_cost) / sales_data.total_revenue * 100, 2)
      ELSE 0
    END AS gross_margin_percent,
    sales_data.total_discounts,
    expense_data.total_expenses,
    GREATEST(sales_data.total_revenue - sales_data.total_cost - sales_data.total_discounts - expense_data.total_expenses, 0) AS net_profit,
    sales_data.invoice_count
  FROM sales_data, expense_data;
END;
$$;

REVOKE ALL ON FUNCTION public.get_profit_loss_summary(UUID, DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profit_loss_summary(UUID, DATE, DATE, UUID) TO authenticated;

-- 4. Customer activity summary
CREATE OR REPLACE FUNCTION public.get_customer_activity_summary(
  p_pharmacy_id UUID,
  p_from_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_to_date DATE DEFAULT CURRENT_DATE,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE(
  customer_name TEXT,
  invoice_count BIGINT,
  total_spent NUMERIC,
  total_discounts NUMERIC,
  last_visit_date TIMESTAMPTZ,
  average_invoice NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.customer_name,
    COUNT(DISTINCT s.id)::BIGINT AS invoice_count,
    COALESCE(SUM(s.total), 0) AS total_spent,
    COALESCE(SUM(s.discount_total), 0) AS total_discounts,
    MAX(s.sale_date) AS last_visit_date,
    ROUND(COALESCE(SUM(s.total), 0) / NULLIF(COUNT(DISTINCT s.id), 0), 2) AS average_invoice
  FROM public.pharmacy_sales s
  WHERE s.pharmacy_id = p_pharmacy_id
    AND s.status NOT IN ('void', 'cancelled')
    AND s.sale_date::DATE >= p_from_date
    AND s.sale_date::DATE <= p_to_date
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
    AND s.customer_name IS NOT NULL
  GROUP BY s.customer_name
  ORDER BY total_spent DESC
  LIMIT 50;
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_activity_summary(UUID, DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_activity_summary(UUID, DATE, DATE, UUID) TO authenticated;

-- 5. Tax summary
CREATE OR REPLACE FUNCTION public.get_tax_summary(
  p_pharmacy_id UUID,
  p_from_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_to_date DATE DEFAULT CURRENT_DATE,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE(
  tax_period TEXT,
  taxable_sales NUMERIC,
  tax_collected NUMERIC,
  invoice_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    to_char(s.sale_date::DATE, 'YYYY-MM') AS tax_period,
    COALESCE(SUM(s.subtotal - s.discount_total), 0) AS taxable_sales,
    COALESCE(SUM(s.tax_total), 0) AS tax_collected,
    COUNT(DISTINCT s.id)::BIGINT AS invoice_count
  FROM public.pharmacy_sales s
  WHERE s.pharmacy_id = p_pharmacy_id
    AND s.status NOT IN ('void', 'cancelled')
    AND s.sale_date::DATE >= p_from_date
    AND s.sale_date::DATE <= p_to_date
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
    AND s.tax_total > 0
  GROUP BY to_char(s.sale_date::DATE, 'YYYY-MM')
  ORDER BY tax_period DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_tax_summary(UUID, DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tax_summary(UUID, DATE, DATE, UUID) TO authenticated;
