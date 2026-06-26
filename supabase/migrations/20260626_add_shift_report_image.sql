-- 1. Add report_image column to shifts table
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS report_image text;

-- 2. Create shift_reports bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('shift_reports', 'shift_reports', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Set up storage policies to allow anyone to view images
CREATE POLICY "Allow public viewing of shift_reports" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'shift_reports');

-- 4. Allow authenticated users to upload shift reports
CREATE POLICY "Allow authenticated uploads to shift_reports" 
ON storage.objects FOR INSERT 
TO authenticated 
WITH CHECK (bucket_id = 'shift_reports');
