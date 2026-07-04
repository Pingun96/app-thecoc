const fetch = require('node-fetch');

const appId = '1d7708c0-a945-4977-b447-ec3ce5b171bf';
const restApiKey = 'os_v2_app_dv3qrqfjivexpnch5q6olmlrx5g7jc5bbdteysnf3jkviuylc35ibz5zyqvme7a5iyd22yqnum27fl5epbox7o47cnvbcl5ojqwv57i';

async function testPush() {
  const oneSignalResponse = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Basic ${restApiKey}`,
    },
    body: JSON.stringify({
      app_id: appId,
      included_segments: ["Subscribed Users"],
      target_channel: "push",
      headings: { en: "Test API Key", vi: "Test API Key" },
      contents: { en: "Testing the new API key to all users", vi: "Testing the new API key to all users" },
    }),
  });
  
  const result = await oneSignalResponse.json();
  console.log('Result:', result);
}

testPush();
