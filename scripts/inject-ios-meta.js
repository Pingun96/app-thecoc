// Script chạy sau khi expo export để inject iOS meta tags vào dist/index.html
const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

// Không cần fix đường dẫn assets nữa vì Cloudflare host ở thư mục gốc (/)

const iosMetaTags = `
    <!-- ===== iOS PWA META TAGS ===== -->
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="The Cốc" />
    <meta name="application-name" content="The Cốc" />
    <meta name="theme-color" content="#F3F7F5" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="format-detection" content="telephone=no" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
    <link rel="apple-touch-icon" sizes="512x512" href="/icons/thecoc-icon-512.png" />
    <!-- iPhone 15 Pro Max -->
    <link rel="apple-touch-startup-image" media="screen and (device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)" href="/icons/thecoc-icon-512.png" />
    <!-- iPhone 14 Pro -->
    <link rel="apple-touch-startup-image" media="screen and (device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)" href="/icons/thecoc-icon-512.png" />
    <!-- iPhone 13/14 -->
    <link rel="apple-touch-startup-image" media="screen and (device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" href="/icons/thecoc-icon-512.png" />
    <!-- iPhone SE -->
    <link rel="apple-touch-startup-image" media="screen and (device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)" href="/icons/thecoc-icon-512.png" />`;

const iosCss = `
      /* ===== iOS NATIVE FEEL ===== */
      * { -webkit-tap-highlight-color: transparent; }
      * { touch-action: manipulation; }
      body { -webkit-user-select: none; user-select: none; overscroll-behavior: none; -webkit-font-smoothing: antialiased; }
      input, textarea { -webkit-user-select: auto; user-select: auto; font-size: 16px !important; }
      a, img { -webkit-touch-callout: none; }
      ::-webkit-scrollbar { display: none; }
      * { scrollbar-width: none; -ms-overflow-style: none; }`;

// 1. Fix viewport - thêm viewport-fit=cover
html = html.replace(
  'width=device-width, initial-scale=1, shrink-to-fit=no',
  'width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover'
);

// 2. Fix title
html = html.replace('<title>thecoc-mobile</title>', '<title>The Cốc</title>');

// 3. Fix lang
html = html.replace('<html lang="en">', '<html lang="vi">');

// 4. Inject iOS meta tags sau viewport
html = html.replace(
  'shrink-to-fit=no, viewport-fit=cover" />',
  `shrink-to-fit=no, viewport-fit=cover" />${iosMetaTags}`
);

// 5. Inject iOS CSS vào style#expo-reset
html = html.replace(
  '/* These styles make the root element full-height */',
  `/* These styles make the root element full-height */${iosCss}\n      /* === */`
);


fs.writeFileSync(indexPath, html, 'utf8');
console.log('✅ iOS meta tags + layout-shift fix injected into dist/index.html');

// 6. Fix node_modules block on Cloudflare Pages
// Cloudflare Pages ignores 'node_modules' folders in the output. Expo web outputs fonts to dist/assets/node_modules/...
// We need to rename 'node_modules' to 'modules' and patch the JS bundles.
const assetsNodeModulesPath = path.join(__dirname, '..', 'dist', 'assets', 'node_modules');
const assetsModulesPath = path.join(__dirname, '..', 'dist', 'assets', 'modules');

if (fs.existsSync(assetsNodeModulesPath)) {
  fs.renameSync(assetsNodeModulesPath, assetsModulesPath);
  console.log('✅ Renamed dist/assets/node_modules to dist/assets/modules');

  // Patch JS files in dist/_expo/static/js/web
  const jsDir = path.join(__dirname, '..', 'dist', '_expo', 'static', 'js', 'web');
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

