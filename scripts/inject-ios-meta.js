const fs = require('fs');
const path = require('path');

const distPath = path.join(__dirname, '..', 'dist');
const indexPath = path.join(distPath, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

const pwaMetaTags = `
    <!-- ===== THECOC PWA META ===== -->
    <meta name="application-name" content="The Coc" />
    <meta name="theme-color" content="#F8FAFC" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="The Coc" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="format-detection" content="telephone=no" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/icons/thecoc-apple-v4.png" />
    <link rel="icon" type="image/png" sizes="512x512" href="/icons/thecoc-icon-v4-512.png" />`;

const pwaCss = `
        /* ===== THECOC PWA SHELL ===== */
        :root {
          --thecoc-page-bg: #F8FAFC;
          --thecoc-shell-bg: #F8FAFC;
          --thecoc-pwa-height: 100dvh;
        }
        * {
          box-sizing: border-box;
          -webkit-tap-highlight-color: transparent;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        html {
          height: -webkit-fill-available;
          background: var(--thecoc-page-bg);
        }
        html, body, #root {
          width: 100%;
          height: 100%;
          min-height: 100%;
          margin: 0;
          padding: 0;
          background: var(--thecoc-shell-bg);
        }
        html, body {
          overflow-x: hidden;
          overflow-y: auto;
          touch-action: auto;
        }
        @supports (height: 100dvh) {
          html, body, #root {
            height: var(--thecoc-pwa-height);
            min-height: var(--thecoc-pwa-height);
            background: var(--thecoc-shell-bg);
          }
        }
        body {
          position: static;
          overscroll-behavior: none;
          -webkit-font-smoothing: antialiased;
          -webkit-user-select: none;
          user-select: none;
        }
        #root {
          display: flex;
          overflow: visible;
          isolation: isolate;
        }
        [style*="overflow"] {
          -webkit-overflow-scrolling: touch;
        }
        input, textarea {
          -webkit-user-select: auto;
          user-select: auto;
          font-size: 16px !important;
        }
        a, img {
          -webkit-touch-callout: none;
        }
        ::-webkit-scrollbar {
          display: none;
        }`;

html = html.replace(
  /<meta name="viewport" content="[^"]*" \/>/,
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />'
);
html = html.replace(/<title>.*?<\/title>/, '<title>The Coc</title>');
html = html.replace('<html lang="en">', '<html lang="vi">');
html = html.replace(
  /(<meta name="viewport" content="[^"]*" \/>)/,
  `$1${pwaMetaTags}`
);
html = html.replace(
  '/* These styles make the root element full-height */',
  `/* These styles make the root element full-height */${pwaCss}\n      /* === */`
);

fs.writeFileSync(indexPath, html, 'utf8');
console.log('✅ PWA shell meta + viewport CSS injected into dist/index.html');

// Cloudflare Pages ignores node_modules folders in the output. Expo web outputs fonts to
// dist/assets/node_modules, so rename that folder and patch the bundle paths.
const assetsNodeModulesPath = path.join(distPath, 'assets', 'node_modules');
const assetsModulesPath = path.join(distPath, 'assets', 'modules');

if (fs.existsSync(assetsNodeModulesPath)) {
  fs.renameSync(assetsNodeModulesPath, assetsModulesPath);
  console.log('✅ Renamed dist/assets/node_modules to dist/assets/modules');

  const jsDir = path.join(distPath, '_expo', 'static', 'js', 'web');
  if (fs.existsSync(jsDir)) {
    const files = fs.readdirSync(jsDir);
    for (const file of files) {
      if (file.endsWith('.js')) {
        const filePath = path.join(jsDir, file);
        let content = fs.readFileSync(filePath, 'utf8');
        if (content.includes('/assets/node_modules/')) {
          content = content.replace(/\/assets\/node_modules\//g, '/assets/modules/');
          fs.writeFileSync(filePath, content, 'utf8');
          console.log(`✅ Patched asset paths in ${file}`);
        }
      }
    }
  }
}

// Cloudflare Pages can behave badly with framework-generated underscored folders.
// Move the Expo bundle out of /_expo and patch index.html to the stable public path.
const expoUnderscorePath = path.join(distPath, '_expo');
const expoStaticPath = path.join(distPath, 'expo-static');
if (fs.existsSync(expoUnderscorePath)) {
  if (fs.existsSync(expoStaticPath)) {
    fs.rmSync(expoStaticPath, { recursive: true, force: true });
  }
  fs.renameSync(expoUnderscorePath, expoStaticPath);
  html = fs.readFileSync(indexPath, 'utf8').replace(/\/_expo\//g, '/expo-static/');
  fs.writeFileSync(indexPath, html, 'utf8');
  console.log('✅ Moved dist/_expo to dist/expo-static and patched script path');
}

