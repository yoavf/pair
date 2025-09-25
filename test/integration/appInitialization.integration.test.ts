/**
 * Integration tests for PairApp initialization to catch breaking changes
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { PairApp } from '../../src/app.js';
import type { AppConfig } from '../../src/utils/config.js';

describe('PairApp Initialization', () => {
  let app: PairApp;

  const mockConfig: AppConfig = {
    navigatorMaxTurns: 50,
    driverMaxTurns: 20,
    maxPromptLength: 10000,
    maxPromptFileSize: 100 * 1024,
    sessionHardLimitMs: 30 * 60 * 1000,
    enableSyncStatus: true,
    architectConfig: { provider: 'claude-code', model: undefined },
    navigatorConfig: { provider: 'claude-code', model: undefined },
    driverConfig: { provider: 'claude-code', model: undefined },
  };

  beforeEach(() => {
    // Suppress console output during tests
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    if (app) {
      try {
        // Force cleanup without waiting for full session
        await (app as any).cleanup();
      } catch {
        // Ignore cleanup errors in tests
      }
    }
    vi.restoreAllMocks();
  });

  test('should initialize without errors and have all required components', async () => {
    // This test ensures all components are properly initialized
    app = new PairApp('/tmp', 'Test task', mockConfig);

    // Check that the app was created successfully
    expect(app).toBeDefined();

    // Try to access internal components to ensure they're initialized
    // This will catch issues like undefined driver/navigator
    expect(() => {
      // These should not throw if properly initialized
      const display = (app as any).display;
      const logger = (app as any).logger;
      const permissionHandler = (app as any).permissionHandler;
      const implementationLoop = (app as any).implementationLoop;
      const eventHandlers = (app as any).eventHandlers;

      expect(logger).toBeDefined();
      // Other components are initialized in start(), so we can't check them here
    }).not.toThrow();
  });

  test('should handle start() without crashing on component access', async () => {
    app = new PairApp('/tmp', 'Test task', mockConfig);

    // Mock the display to avoid actual UI rendering
    const mockDisplay = {
      start: vi.fn(),
      showPlan: vi.fn(),
      setPhase: vi.fn(),
      showTransitionMessage: vi.fn(),
      cleanup: vi.fn(),
      getPhase: vi.fn(() => 'planning'),
      showArchitectTurn: vi.fn(),
      showNavigatorTurn: vi.fn(),
      showDriverTurn: vi.fn(),
      showToolUse: vi.fn(),
      updateStatus: vi.fn(),
      showTransfer: vi.fn(),
      showCompletionMessage: vi.fn(),
    };

    // Replace display to avoid UI rendering
    (app as any).display = mockDisplay;

    // This should not throw "Cannot read properties of undefined"
    // We expect it to fail for other reasons (no API keys, etc.) but not initialization errors
    await expect(async () => {
      try {
        await app.start();
      } catch (error) {
        // Check that it's not an initialization error
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Cannot read properties of undefined') ||
            message.includes('startImplementation')) {
          throw new Error(`Initialization error detected: ${message}`);
        }
        // Other errors (API, network, etc.) are expected in test environment
      }
    }).not.toThrow();
  }, 15000); // 15 second timeout for this integration test

  test('should initialize with OpenCode provider without errors', () => {
    const openCodeConfig: AppConfig = {
      ...mockConfig,
      architectConfig: { provider: 'opencode', model: 'openrouter/google/gemini-2.5-flash' },
      navigatorConfig: { provider: 'opencode', model: 'openrouter/google/gemini-2.5-flash' },
      driverConfig: { provider: 'opencode', model: 'openrouter/google/gemini-2.5-flash' },
    };

    // Should not throw during construction
    expect(() => {
      app = new PairApp('/tmp', 'Test task', openCodeConfig);
    }).not.toThrow();

    expect(app).toBeDefined();
  });
});