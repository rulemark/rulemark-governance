import { afterEach } from 'vitest';

import '@rulemark/ui/globals.css';
import { setColorScheme } from './test-support';

// Every test starts with the OS preferring light, no theme remembered, and no
// data-theme left on <html> by next-themes.
afterEach(async () => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.removeProperty('color-scheme');
  await setColorScheme('light');
});
