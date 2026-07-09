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
    :root { --sat: 0px; --sab: 0px; }
    html, body, #root {
      height: auto;
      min-height: 100%;
      width: 100%;
      background: #F3F7F5;
      overscroll-behavior-y: none;
      -webkit-tap-highlight-color: transparent;
      -webkit-touch-callout: none;
      touch-action: auto;
      -webkit-text-size-adjust: 100%;
      text-size-adjust: 100%;
    }
    body {
      margin: 0;
      padding: 0;
      overflow-x: hidden;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
    }
    .r-150rngu,
    .r-150rngu * {
      -webkit-overflow-scrolling: touch !important;
      touch-action: auto !important;
    }
    .r-150rngu {
      overflow-y: auto !important;
      overscroll-behavior-y: contain;
    }
    @media (max-width: 480px) {
      :root {
        --sat: env(safe-area-inset-top, 0px);
        --sab: env(safe-area-inset-bottom, 0px);
      }
      html, body, #root {
        min-height: 100dvh;
      }
      *,
      *::before,
      *::after {
        box-shadow: none !important;
        text-shadow: none !important;
        filter: none !important;
        -webkit-filter: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }
    }
    input, textarea, select {
      font-size: 16px !important;
    }
  `;
  document.head.appendChild(style);
};

const isEditableTarget = (target) => {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
};

const canScrollInDirection = (element, deltaY) => {
  const maxScroll = element.scrollHeight - element.clientHeight;
  if (maxScroll <= 1) return false;
  if (!deltaY) return true;
  if (deltaY > 0) return element.scrollTop < maxScroll;
  return element.scrollTop > 0;
};

const findScrollableElement = (target, deltaY = 0) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  let element = target instanceof Element ? target : null;

  while (element && element !== document.body && element !== document.documentElement) {
    const style = window.getComputedStyle(element);
    const isScrollView = element.classList?.contains('r-150rngu');
    const canOverflow = /(auto|scroll|overlay)/.test(style.overflowY) || isScrollView;
    if (canOverflow && canScrollInDirection(element, deltaY)) return element;
    element = element.parentElement;
  }

  const pageScroller = document.scrollingElement || document.documentElement;
  return canScrollInDirection(pageScroller, deltaY) ? pageScroller : null;
};

const installTouchScrollRescue = () => {
  if (
    typeof window === 'undefined'
    || typeof document === 'undefined'
    || window.__THECOC_TOUCH_SCROLL_RESCUE__
  ) {
    return;
  }

  const hasTouch = 'ontouchstart' in window || Number(navigator.maxTouchPoints || 0) > 0;
  if (!hasTouch) return;

  window.__THECOC_TOUCH_SCROLL_RESCUE__ = true;
  let touchState = null;

  const resetTouchState = () => {
    touchState = null;
  };

  document.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1 || isEditableTarget(event.target)) {
      resetTouchState();
      return;
    }

    const touch = event.touches[0];
    touchState = {
      startX: touch.clientX,
      startY: touch.clientY,
      lastY: touch.clientY,
      target: event.target,
      isVerticalDrag: false,
    };
  }, { capture: true, passive: true });

  document.addEventListener('touchmove', (event) => {
    if (!touchState || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const totalX = touch.clientX - touchState.startX;
    const totalY = touch.clientY - touchState.startY;

    if (!touchState.isVerticalDrag) {
      if (Math.abs(totalY) < 6 || Math.abs(totalY) < Math.abs(totalX) * 1.15) return;
      touchState.isVerticalDrag = true;
    }

    const deltaY = touchState.lastY - touch.clientY;
    touchState.lastY = touch.clientY;
    if (Math.abs(deltaY) < 1) return;

    const scrollElement = findScrollableElement(touchState.target, deltaY) || findScrollableElement(event.target, deltaY);
    if (!scrollElement) return;

    const maxScroll = scrollElement.scrollHeight - scrollElement.clientHeight;
    const nextTop = Math.max(0, Math.min(maxScroll, scrollElement.scrollTop + deltaY));
    if (nextTop === scrollElement.scrollTop) return;

    scrollElement.scrollTop = nextTop;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  }, { capture: true, passive: false });

  document.addEventListener('touchend', resetTouchState, { capture: true, passive: true });
  document.addEventListener('touchcancel', resetTouchState, { capture: true, passive: true });
};

export const setupPwaExperience = () => {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') return;

  const segments = window.location.pathname.split('/').filter(Boolean);
  const basePath = segments.length ? `/${segments[0]}` : '';
  const assetPath = (path) => `${basePath}${path}`;

  document.documentElement.lang = 'vi';
  document.title = 'The Cốc';
  upsertStyle();
  installTouchScrollRescue();

  upsertMeta('meta[name="viewport"]', {
    name: 'viewport',
    content: 'width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no',
  });
  upsertMeta('meta[name="theme-color"]', { name: 'theme-color', content: '#F3F7F5' });
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
