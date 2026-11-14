import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { nativeApp } from './lib/transport';

if (!nativeApp && import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      const announce = () => { if (reg.waiting && navigator.serviceWorker.controller) window.dispatchEvent(new CustomEvent('app-update', { detail: reg })); };
      announce();
      reg.addEventListener('updatefound', () => reg.installing?.addEventListener('statechange', announce));
    }).catch(error => console.warn('Offline support unavailable', error));
  });
}

if (nativeApp) {
  document.documentElement.classList.add('native-app');
  import('@capacitor/app').then(({ App }) => {
    App.addListener('backButton', ({ canGoBack }) => {
      if (document.querySelector('.pdf-viewer')) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      } else if (canGoBack) window.history.back();
      else App.minimizeApp();
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
