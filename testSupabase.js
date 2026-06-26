const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://gdgoitbivzpcvoirgvjh.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdkZ29pdGJpdnpwY3ZvaXJndmpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNjczOTIsImV4cCI6MjA5Nzg0MzM5Mn0.gye95SMzxRolaPQjhILNELpNRJ596-fHi1UJLv2S8rI');

async function fixNotes() {
  const { data, error } = await supabase.from('payroll_adjustments').select('*');
  if (error) {
    console.error(error);
    return;
  }
  
  for (const row of data) {
    if (row.id.startsWith('adj_shift_') && row.note.includes('âm (ca')) {
      const match = row.note.match(/âm \(ca (.*?)\)/);
      if (match) {
        const dateStr = match[1];
        const newNote = `Hệ thống tự trừ tiền do lệch két âm ${row.penalty_money.toLocaleString('vi-VN')}đ (ca ${dateStr})`;
        console.log(`Updating ${row.id} to: ${newNote}`);
        await supabase.from('payroll_adjustments').update({ note: newNote }).eq('id', row.id);
      }
    }
  }
  console.log('Done!');
}

fixNotes();
