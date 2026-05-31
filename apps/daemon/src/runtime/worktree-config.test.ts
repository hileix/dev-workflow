import { describe, expect, test } from "vitest";
import { normalizeWorktreeConfig } from "./worktree";

describe("normalizeWorktreeConfig", () => {
  test("uses built-in setup when custom setup is not enabled", () => {
    const config = normalizeWorktreeConfig({
      enabled: true,
      files: [".env"],
      useCustomSetupScript: false,
      setupScript: "pnpm install",
    });

    expect(config.files).toEqual([".env"]);
    expect(config.useCustomSetupScript).toBe(false);
    expect(config.setupScript).toBe("");
  });

  test("requires a custom script when custom setup is enabled", () => {
    expect(() => normalizeWorktreeConfig({
      enabled: true,
      useCustomSetupScript: true,
      setupScript: " ",
    })).toThrow("git worktree custom setup script is required");
  });

  test("keeps the custom script when custom setup is enabled", () => {
    const config = normalizeWorktreeConfig({
      enabled: true,
      files: [".env"],
      useCustomSetupScript: true,
      setupScript: " pnpm install ",
    });

    expect(config.useCustomSetupScript).toBe(true);
    expect(config.setupScript).toBe("pnpm install");
  });
});
