const fetch = require('node-fetch');

const appId = '1d7708c0-a945-4977-b447-ec3ce5b171bf';
const restApiKey = 'os_v2_app_dv3qrqfjivexpnch5q6olmlrx4v3xn7epquerrvwbgxpdkq7td6og3zakgrx32oiqsqproqjepkdhatctw6q5xaf7behr7tvthi6soi';

async function checkOneSignal() {
  const res = await fetch(`https://onesignal.com/api/v1/players?app_id=${appId}&limit=50`, {
    headers: { 'Authorization': `Basic ${restApiKey}` } // For v1/players it actually uses Basic
  });
  
  // Wait, let's try with `Key ` instead if it fails.
  let res2 = await fetch(`https://onesignal.com/api/v1/players?app_id=${appId}&limit=50`, {
    headers: { 'Authorization': `Key ${restApiKey}` }
  });
  
  const data = await res2.json();
  if (data && data.players) {
    console.log(`Found ${data.players.length} players in OneSignal.`);
    data.players.forEach(p => {
      console.log(`ID: ${p.id}, Platform: ${p.device_type}, ExternalID: ${p.external_user_id}, Active: ${p.active}`);
    });
  } else {
    console.log('Error or no players with Key:', data);
  }
}

checkOneSignal();
