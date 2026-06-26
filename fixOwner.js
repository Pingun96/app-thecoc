const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://gdgoitbivzpcvoirgvjh.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdkZ29pdGJpdnpwY3ZvaXJndmpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNjczOTIsImV4cCI6MjA5Nzg0MzM5Mn0.gye95SMzxRolaPQjhILNELpNRJ596-fHi1UJLv2S8rI';
const supabase = createClient(supabaseUrl, supabaseAnonKey);
async function test() {
  const { data, error } = await supabase.from('users').update({ role: 'OWNER' }).eq('phone', '0353548000');
  console.log('Update Error:', error);
  const { data: users } = await supabase.from('users').select('*').eq('phone', '0353548000');
  console.log('Fixed User:', users);
}
test();
