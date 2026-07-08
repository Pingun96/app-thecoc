const puppeteer = require('puppeteer');
const handler = require('serve-handler');
const http = require('http');

const server = http.createServer((request, response) => {
  return handler(request, response, { public: 'dist' });
});

server.listen(5000, async () => {
  console.log('Server running on 5000');
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
  page.on('requestfailed', request => console.log('REQUEST FAILED:', request.url(), request.failure().errorText));

  // Visit the local server, but with the subdirectory appended if needed.
  // Actually, wait, if index.html has `<script src="/app-thecoc/_expo/...`, we need to mount it at `/app-thecoc/`
  // To simulate GitHub Pages, let's just rewrite `/app-thecoc` requests to `/`
  // No, serve-handler doesn't do that by default.
  // We can just visit the live GitHub Pages site!
  await page.goto('https://pingun96.github.io/app-thecoc/', { waitUntil: 'networkidle0' });

  // Get the HTML body to see what rendered
  const bodyHTML = await page.evaluate(() => document.body.innerHTML);
  console.log('BODY HTML LENGTH:', bodyHTML.length);
  if (bodyHTML.length < 500) {
      console.log('BODY:', bodyHTML);
  }

  await browser.close();
  server.close();
});
