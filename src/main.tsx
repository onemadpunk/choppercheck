import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Refresh an already-open app when its new offline bundle activates, retaining saved preferences.
if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

createRoot(document.getElementById('root')!).render(<App />);

