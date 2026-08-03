import { describe, expect, it } from "vitest";
import { openPathCommand } from "../../server/platform.js";

describe("桌面系统命令", () => {
  it("在 macOS 使用 open", () => {
    expect(openPathCommand("/Users/muzi/Documents", "darwin")).toEqual({
      command: "open",
      args: ["/Users/muzi/Documents"],
    });
  });

  it("在 Windows 使用 explorer.exe 并保留带空格路径", () => {
    expect(openPathCommand("C:\\Users\\Muzi User\\AppData\\Local\\MuziWorkspace", "win32")).toEqual({
      command: "explorer.exe",
      args: ["C:\\Users\\Muzi User\\AppData\\Local\\MuziWorkspace"],
    });
  });
});
