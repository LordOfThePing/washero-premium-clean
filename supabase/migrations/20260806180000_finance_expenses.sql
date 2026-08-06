-- Finance expenses synced from Google Forms / Sheets + shared net-split settings

CREATE TABLE IF NOT EXISTS public.finance_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date date NOT NULL,
  payer text NOT NULL CHECK (payer IN ('salva', 'moru', 'washero')),
  concept text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  amount numeric(14, 2) NOT NULL CHECK (amount >= 0),
  payment_method text NULL,
  notes text NULL,
  sheet_row_key text NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_expenses_sheet_row_key_unique UNIQUE (sheet_row_key)
);

CREATE INDEX IF NOT EXISTS finance_expenses_expense_date_idx
  ON public.finance_expenses (expense_date);
CREATE INDEX IF NOT EXISTS finance_expenses_payer_idx
  ON public.finance_expenses (payer);
CREATE INDEX IF NOT EXISTS finance_expenses_payer_date_idx
  ON public.finance_expenses (payer, expense_date);

ALTER TABLE public.finance_expenses ENABLE ROW LEVEL SECURITY;

-- Admins can read; writes are done by the sync edge function (service role bypasses RLS).
DROP POLICY IF EXISTS "finance_expenses admin select" ON public.finance_expenses;
CREATE POLICY "finance_expenses admin select" ON public.finance_expenses
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE TABLE IF NOT EXISTS public.finance_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  truck_owner_pct numeric(6, 2) NOT NULL DEFAULT 85
    CHECK (truck_owner_pct >= 0 AND truck_owner_pct <= 100),
  washero_pct numeric(6, 2) NOT NULL DEFAULT 15
    CHECK (washero_pct >= 0 AND washero_pct <= 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_settings_pct_sum CHECK (truck_owner_pct + washero_pct = 100)
);

INSERT INTO public.finance_settings (id, truck_owner_pct, washero_pct)
VALUES (1, 85, 15)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS finance_settings_set_updated_at ON public.finance_settings;
CREATE TRIGGER finance_settings_set_updated_at
  BEFORE UPDATE ON public.finance_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.finance_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance_settings admin all" ON public.finance_settings;
CREATE POLICY "finance_settings admin all" ON public.finance_settings
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
