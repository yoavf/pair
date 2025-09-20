/**
 * Vitest test setup file
 * Global configuration and mocks for all tests
 */

import { vi } from 'vitest';

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  // Uncomment to silence logs during tests
  // log: vi.fn(),
  // warn: vi.fn(),
  // error: vi.fn(),
};

// Clean up after each test
afterEach(() => {
  vi.clearAllMocks();
});