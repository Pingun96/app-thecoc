import { Platform } from 'react-native';

const upsertMeta = (selector, attributes) => {
  if (typeof document === 'undefined') return;
  let node = document.head.querySelector(selector);
  if (!node) {
    node = document.createElement('meta');
    document.head.appendChild(node);
  }
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
};

const upsertLink = (selector, attributes) => {
  if (typeof document === 'undefined') return;
  let node = document.head.querySelector(selector);
  if (!node) {
    node = document.createElement('link');
    document.head.appendChild(node);
  }
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
};

const upsertStyle = () => {
  if (typeof document === 'undefined') return;
  const id = 'thecoc-pwa-style';
  if (document.getElementById(id)) return;

  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
    :root {
      --thecoc-page-bg: #F8FAFC;
      --thecoc-shell-bg: #F8FAFC;
      --thecoc-pwa-height: 100dvh;
    }
    html {
      height: -webkit-fill-available;
      background: var(--thecoc-page-bg);
    }
    html, body, #root {
      height: 100%;
      min-height: 100%;
      width: 100%;
      margin: 0;
      padding: 0;
      background: var(--thecoc-shell-bg);
      overscroll-behavior: none;
      -webkit-tap-highlight-color: transparent;
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
      -webkit-user-select: none;
      user-select: none;
      -webkit-font-smoothing: antialiased;
    }
    #root {
      display: flex;
      overflow: visible;
      isolation: isolate;
    }
    [style*="overflow"] {
      -webkit-overflow-scrolling: touch;
    }
    input, textarea, select {
      font-size: 16px !important;
      -webkit-user-select: auto;
      user-select: auto;
    }
    a, img {
      -webkit-touch-callout: none;
    }
    ::-webkit-scrollbar {
      display: none;
    }
    * {
      scrollbar-width: none;
      -ms-overflow-style: none;
      box-sizing: border-box;
    }
  `;
  document.head.appendChild(style);
};


const syncStandaloneIosViewportHeight = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const isIosStandalone = /iPad|iPhone|iPod/.test(window.navigator.userAgent)
    && (window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches);
  if (!isIosStandalone) return;

  const syncHeight = () => {
    const screenHeight = Number(window.screen?.height || 0);
    const viewportHeight = Math.max(
      Number(window.innerHeight || 0),
      Number(document.documentElement.clientHeight || 0)
    );
    const appHeight = Math.max(screenHeight, viewportHeight);
    if (appHeight > 0) {
      document.documentElement.style.setProperty('--thecoc-pwa-height', `${appHeight}px`);
    }
  };

  syncHeight();
  window.addEventListener('resize', syncHeight);
  window.addEventListener('orientationchange', syncHeight);
  window.visualViewport?.addEventListener?.('resize', syncHeight);
};
export const setupPwaExperience = () => {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') return;

  const segments = window.location.pathname.split('/').filter(Boolean);
  const basePath = segments.length ? `/${segments[0]}` : '';
  const assetPath = (path) => `${basePath}${path}`;

  document.documentElement.lang = 'vi';
  document.title = 'The Cốc';
  upsertStyle();
  syncStandaloneIosViewportHeight();

  upsertMeta('meta[name="viewport"]', {
    name: 'viewport',
    content: 'width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no',
  });
  upsertMeta('meta[name="theme-color"]', { name: 'theme-color', content: '#208AEF' });
  upsertMeta('meta[name="mobile-web-app-capable"]', { name: 'mobile-web-app-capable', content: 'yes' });
  upsertMeta('meta[name="apple-mobile-web-app-capable"]', { name: 'apple-mobile-web-app-capable', content: 'yes' });
  upsertMeta('meta[name="apple-mobile-web-app-title"]', { name: 'apple-mobile-web-app-title', content: 'The Cốc' });
  upsertMeta('meta[name="apple-mobile-web-app-status-bar-style"]', {
    name: 'apple-mobile-web-app-status-bar-style',
    content: 'black-translucent',
  });
  upsertMeta('meta[name="format-detection"]', { name: 'format-detection', content: 'telephone=no' });

  upsertLink('link[rel="manifest"]', { rel: 'manifest', href: assetPath('/manifest.webmanifest') });
  upsertLink('link[rel="apple-touch-icon"]', { rel: 'apple-touch-icon', href: assetPath('/icons/thecoc-apple-v4.png') });
  upsertLink('link[rel="icon"][sizes="512x512"]', {
    rel: 'icon',
    type: 'image/png',
    sizes: '512x512',
    href: assetPath('/icons/thecoc-icon-v4-512.png'),
  });

  if ('serviceWorker' in navigator) {
    // Do not force a browser reload when a new service worker activates.
    // A forced reload made the login page visibly mount twice on PWA startup.
    const skipWaiting = (worker) => worker?.postMessage?.({ type: 'SKIP_WAITING' });
    navigator.serviceWorker
      .register(assetPath('/pwa-service-worker.js'), { scope: `${basePath || ''}/` })
      .then((registration) => {
        skipWaiting(registration.waiting);
        registration.update?.();
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              skipWaiting(worker);
            }
          });
        });
      })
      .catch((error) => console.log('Cannot register PWA service worker:', error?.message || error));
  }

  const ONESIGNAL_APP_ID = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID || '1d7708c0-a945-4977-b447-ec3ce5b171bf';
  const oneSignalAllowedHosts = (process.env.EXPO_PUBLIC_ONESIGNAL_ALLOWED_HOSTS || 'app-thecoc.pages.dev')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const canInitOneSignal = oneSignalAllowedHosts.includes(window.location.hostname.toLowerCase());
  const oneSignalWorkerPath = `${basePath || ''}/pwa-service-worker.js`;
  const oneSignalWorkerScope = `${basePath || ''}/`;

  const initOneSignal = () => {
    if (window.__THECOC_ONESIGNAL_INIT_STARTED__) return;
    window.__THECOC_ONESIGNAL_INIT_STARTED__ = true;
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal) => {
      await OneSignal.init({
        appId: ONESIGNAL_APP_ID,
        allowLocalhostAsSecureOrigin: true,
        serviceWorkerParam: { scope: oneSignalWorkerScope },
        serviceWorkerPath: oneSignalWorkerPath,
        notifyButton: { enable: false },
        welcomeNotification: { disable: true },
      });
      
      OneSignal.Notifications?.addEventListener('foregroundWillDisplay', (event) => {
        const notif = event.notification;
        if (notif) {
          window.dispatchEvent(new CustomEvent('onForegroundPush', {
            detail: { title: notif.title, body: notif.body, data: notif.additionalData }
          }));
        }
      });
      
      window.__THECOC_ONESIGNAL_READY__ = true;
    });
  };

  if (canInitOneSignal && ONESIGNAL_APP_ID && ONESIGNAL_APP_ID !== 'YOUR_ONESIGNAL_APP_ID') {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    initOneSignal();
    if (!document.getElementById('onesignal-sdk')) {
      const script = document.createElement('script');
      script.id = 'onesignal-sdk';
      script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
      script.defer = true;
      document.head.appendChild(script);
    }
  }
};
