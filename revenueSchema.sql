CREATE TABLE IF NOT EXISTS public.daily_revenue (
    id TEXT PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    total_amount NUMERIC NOT NULL DEFAULT 0,
    order_count INTEGER DEFAULT 0,
    source TEXT DEFAULT 'OCHA',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    UNIQUE(store_id, date)
);

ALTER TABLE public.daily_revenue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Revenue viewable by owner and managers" ON public.daily_revenue
    FOR SELECT
    TO authenticated
    USING (
        auth.uid()::text IN (SELECT id FROM public.users WHERE role = 'OWNER')
        OR
        (
            auth.uid()::text IN (SELECT id FROM public.users WHERE role = 'MANAGER')
            AND
            store_id = (SELECT store_id FROM public.users WHERE id = auth.uid()::text LIMIT 1)
        )
    );

CREATE POLICY "Revenue insertable by owner" ON public.daily_revenue
    FOR ALL
    TO authenticated
    USING (
        auth.uid()::text IN (SELECT id FROM public.users WHERE role = 'OWNER')
    );
