import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { parseCliArgs, showHelp } from "../../../src/utils/cli.js";
import type { AppConfig } from "../../../src/utils/config.js";

// Mock dependencies
vi.mock("../../../src/utils/config.js", () => ({
  loadConfig: vi.fn(),
  validateConfig: vi.fn(),
}));

vi.mock("../../../src/utils/validation.js", () => ({
  validateAndReadPromptFile: vi.fn(),
  validateAndSanitizePath: vi.fn((path: string) => path),
  validatePrompt: vi.fn((prompt: string) => prompt),
}));

vi.mock("../../../src/utils/version.js", () => ({
  getVersion: vi.fn(() => "1.0.0"),
}));

vi.mock("../../../src/providers/factory.js", () => ({
  agentProviderFactory: {
    getAvailableProviders: vi.fn(() => ["claude-code", "opencode"]),
  },
}));

describe("CLI Utils", () => {
  let mockConfig: AppConfig;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    mockConfig = {
      maxPromptLength: 10000,
      sessionHardLimitMs: 3600000,
      navigatorMaxTurns: 50,
      driverMaxTurns: 20,
      enableSyncStatus: false,
      navigatorConfig: { provider: "claude-code", model: undefined },
      driverConfig: { provider: "claude-code", model: undefined },
    };

    const { loadConfig, validateConfig } = await import("../../../src/utils/config.js");
    vi.mocked(loadConfig).mockReturnValue(mockConfig);
    vi.mocked(validateConfig).mockImplementation(() => {});

    const { validateAndReadPromptFile, validateAndSanitizePath, validatePrompt } = await import("../../../src/utils/validation.js");
    vi.mocked(validateAndReadPromptFile).mockImplementation((file) => `Content from ${file}`);
    vi.mocked(validateAndSanitizePath).mockImplementation((path) => path);
    vi.mocked(validatePrompt).mockImplementation((prompt) => prompt);

    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    consoleSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe("showHelp", () => {
    it("should display help via Commander.js", () => {
      expect(() => showHelp()).toThrow("process.exit called");
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe("parseCliArgs", () => {
    describe("basic usage", () => {
      it("should parse required prompt", async () => {
        const args = ["-p", "Test task"];

        const result = await parseCliArgs(args);

        expect(result.task).toBe("Test task");
        expect(result.projectPath).toBe(process.cwd());
      });

      it("should use file input over prompt", async () => {
        const args = ["-p", "Test task", "-f", "prompt.txt"];

        const result = await parseCliArgs(args);

        const { validateAndReadPromptFile } = await import("../../../src/utils/validation.js");
        expect(validateAndReadPromptFile).toHaveBeenCalledWith("prompt.txt");
        expect(result.task).toBe("Content from prompt.txt");
      });

      it("should set custom directory", async () => {
        const args = ["-p", "Test task", "-d", "/custom/path"];

        const result = await parseCliArgs(args);

        expect(result.projectPath).toBe("/custom/path");
      });
    });

    describe("provider configuration", () => {
      it("should configure navigator provider and model", async () => {
        const args = [
          "-p", "Test task",
          "--navigator", "opencode",
          "--navigator-model", "sonnet"
        ];

        const result = await parseCliArgs(args);

        expect(result.config.navigatorConfig).toEqual({
          provider: "opencode",
          model: "sonnet"
        });
      });

      it("should configure driver provider and model", async () => {
        const args = [
          "-p", "Test task",
          "--driver", "opencode",
          "--driver-model", "opus"
        ];

        const result = await parseCliArgs(args);

        expect(result.config.driverConfig).toEqual({
          provider: "opencode",
          model: "opus"
        });
      });

      it("should use default providers when not specified", async () => {
        const args = ["-p", "Test task"];

        const result = await parseCliArgs(args);

        expect(result.config.navigatorConfig.provider).toBe("claude-code");
        expect(result.config.driverConfig.provider).toBe("claude-code");
      });
    });

    describe("complex scenarios", () => {
      it("should configure all options together", async () => {
        const args = [
          "-p", "Complex task",
          "-d", "/test/project",
          "--navigator", "claude-code",
          "--navigator-model", "sonnet",
          "--driver", "opencode",
          "--driver-model", "opus"
        ];

        const result = await parseCliArgs(args);

        expect(result.projectPath).toBe("/test/project");
        expect(result.task).toBe("Complex task");
        expect(result.config.navigatorConfig).toEqual({ provider: "claude-code", model: "sonnet" });
        expect(result.config.driverConfig).toEqual({ provider: "opencode", model: "opus" });
      });

      it("should handle model names with special characters", async () => {
        const args = [
          "-p", "Test",
          "--navigator-model", "openrouter/google/gemini-2.5-flash"
        ];

        const result = await parseCliArgs(args);

        expect(result.config.navigatorConfig.model).toBe("openrouter/google/gemini-2.5-flash");
      });
    });

    describe("validation integration", () => {
      it("should call validation functions", async () => {
        const args = ["-p", "Test task", "-d", "/custom/path"];

        await parseCliArgs(args);

        const { validatePrompt, validateAndSanitizePath } = await import("../../../src/utils/validation.js");
        const { validateConfig } = await import("../../../src/utils/config.js");
        expect(validateConfig).toHaveBeenCalledTimes(2); // Initial + after CLI overrides
        expect(validatePrompt).toHaveBeenCalledWith("Test task", mockConfig.maxPromptLength);
        expect(validateAndSanitizePath).toHaveBeenCalledWith("/custom/path");
      });

      it("should preserve other config values", async () => {
        const args = ["-p", "Test task"];

        const result = await parseCliArgs(args);

        expect(result.config.maxPromptLength).toBe(mockConfig.maxPromptLength);
        expect(result.config.sessionHardLimitMs).toBe(mockConfig.sessionHardLimitMs);
        expect(result.config.navigatorMaxTurns).toBe(mockConfig.navigatorMaxTurns);
      });
    });
  });
});