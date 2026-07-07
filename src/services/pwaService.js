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
    html,
    body,
    #root {
      width: 100%;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      background: #F3F7F5;
      -webkit-tap-highlight-color: transparent;
      -webkit-touch-callout: none;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    html {
      min-height: 100%;
      margin: 0;
      padding: 0;
      overflow-x: hidden;
      scroll-padding-top: 0;
    }
    body {
      min-height: 100%;
      margin: 0 !important;
      padding: 0 !important;
      padding-top: 0 !important;
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior-y: contain;
      -webkit-overflow-scrolling: touch;
    }
    html,
    body,
    #root,
    #root * {
      -webkit-overflow-scrolling: touch;
    }
    #root {
      display: flex;
      min-height: 100dvh;
      position: relative;
      top: 0 !important;
      box-sizing: border-box;
      margin-top: 0 !important;
      padding-top: 0 !important;
      background: #F3F7F5;
      padding-left: env(safe-area-inset-left);
      padding-right: env(safe-area-inset-right);
    }
    #root > * {
      min-height: 0;
    }
    a,
    button,
    [role="button"] {
      touch-action: manipulation;
    }
    input, textarea, select {
      font-family: inherit;
      font-size: 16px !important;
      touch-action: auto;
    }
  `;
  document.head.appendChild(style);
};

export const setupPwaExperience = () => {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') return;

  const segments = window.location.pathname.split('/').filter(Boolean);
  const basePath = segments.length ? `/${segments[0]}` : '';
  const assetPath = (path) => `${basePath}${path}`;

  document.documentElement.lang = 'vi';
  document.title = 'The Cốc';
  upsertStyle();

  upsertMeta('meta[name="viewport"]', {
    name: 'viewport',
    content: 'width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no',
  });
  upsertMeta('meta[name="theme-color"]', { name: 'theme-color', content: '#6B3F24' });
  upsertMeta('meta[name="mobile-web-app-capable"]', { name: 'mobile-web-app-capable', content: 'yes' });
  upsertMeta('meta[name="apple-mobile-web-app-capable"]', { name: 'apple-mobile-web-app-capable', content: 'yes' });
  upsertMeta('meta[name="apple-mobile-web-app-title"]', { name: 'apple-mobile-web-app-title', content: 'The Cốc' });
  upsertMeta('meta[name="apple-mobile-web-app-status-bar-style"]', {
    name: 'apple-mobile-web-app-status-bar-style',
    content: 'black-translucent',
  });
  upsertMeta('meta[name="format-detection"]', { name: 'format-detection', content: 'telephone=no' });

  upsertLink('link[rel="manifest"]', { rel: 'manifest', href: assetPath('/manifest.webmanifest') });
  upsertLink('link[rel="apple-touch-icon"]', { rel: 'apple-touch-icon', href: assetPath('/icons/apple-touch-icon.png') });
  upsertLink('link[rel="icon"][sizes="512x512"]', {
    rel: 'icon',
    type: 'image/png',
    sizes: '512x512',
    href: assetPath('/icons/thecoc-icon-512.png'),
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register(assetPath('/pwa-service-worker.js'), { scope: `${basePath || ''}/` })
      .catch((error) => console.log('Cannot register PWA service worker:', error?.message || error));
  }

  const ONESIGNAL_APP_ID = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID || '1d7708c0-a945-4977-b447-ec3ce5b171bf';
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

  if (ONESIGNAL_APP_ID && ONESIGNAL_APP_ID !== 'YOUR_ONESIGNAL_APP_ID') {
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
