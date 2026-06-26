const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://gdgoitbivzpcvoirgvjh.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdkZ29pdGJpdnpwY3ZvaXJndmpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNjczOTIsImV4cCI6MjA5Nzg0MzM5Mn0.gye95SMzxRolaPQjhILNELpNRJ596-fHi1UJLv2S8rI');

async function check() {
  const { data, error } = await supabase.from('shifts').select('report_image').limit(1);
  console.log('Data:', data);
  console.log('Error:', error);
}

check();
