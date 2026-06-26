const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://gdgoitbivzpcvoirgvjh.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdkZ29pdGJpdnpwY3ZvaXJndmpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNjczOTIsImV4cCI6MjA5Nzg0MzM5Mn0.gye95SMzxRolaPQjhILNELpNRJ596-fHi1UJLv2S8rI');

async function ensureBucket() {
  const { data, error } = await supabase.storage.getBucket('shift_reports');
  if (error && error.message.includes('not found')) {
    console.log('Bucket not found, creating...');
    const { data: createData, error: createError } = await supabase.storage.createBucket('shift_reports', {
      public: true,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg'],
    });
    console.log('Create:', createData, createError);
  } else {
    console.log('Bucket exists or error:', data, error);
  }
}

ensureBucket();
