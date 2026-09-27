import { describe } from 'vitest';

import { SOURCE_ARGS } from './process.js';
import { startupTests } from './start.js';

describe('the receiver, from its sources', () => startupTests(SOURCE_ARGS));
