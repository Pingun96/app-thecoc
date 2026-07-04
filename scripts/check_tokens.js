const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://gdgoitbivzpcvoirgvjh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdkZ29pdGJpdnpwY3ZvaXJndmpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNjczOTIsImV4cCI6MjA5Nzg0MzM5Mn0.gye95SMzxRolaPQjhILNELpNRJ596-fHi1UJLv2S8rI';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTokens() {
  const { data, error } = await supabase.from('push_tokens').select('*');
  if (error) {
    console.error('Error fetching tokens:', error);
  } else {
    console.log(`Total tokens: ${data.length}`);
    data.forEach(t => console.log(`User: ${t.user_id}, Platform: ${t.platform}, Token: ${t.expo_push_token}`));
  }
}

checkTokens();
