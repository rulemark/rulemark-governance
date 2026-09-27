import { afterEach } from 'vitest';

import { parkPointer, setColorScheme, setDataTheme } from './test-support';
import './styles/globals.css';

// Every test starts in the light theme with the OS preferring light, and with
// nothing hovered.
afterEach(async () => {
  setDataTheme(undefined);
  await setColorScheme('light');
  await parkPointer();
});
