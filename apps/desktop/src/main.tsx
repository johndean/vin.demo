import { createRoot } from 'react-dom/client';
import App from './app';

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
// Hide the boot splash once React has mounted (login shows first, before the control room).
document.getElementById('boot')?.style.setProperty('display', 'none');

// Wire the (frameless) titlebar traffic-light dots to the real window controls (preload).
const api = (window as unknown as { win?: { minimize(): void; maximize(): void; close(): void } }).win;
document.querySelectorAll<HTMLElement>('[data-win]').forEach((el) => {
  el.addEventListener('click', () => {
    const action = el.dataset.win as 'minimize' | 'maximize' | 'close';
    api?.[action]?.();
  });
});
