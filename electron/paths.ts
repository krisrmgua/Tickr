import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";

/**
 * `~/Library/Application Support/Tickr` on macOS, the same folder the Swift
 * app used for its API key and logo cache. `%APPDATA%\Tickr` on Windows.
 */
export function userDir(): string {
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function prefsPath(): string {
  return path.join(userDir(), "prefs.json");
}

export function apiKeyPath(): string {
  return path.join(userDir(), "positions-api-key");
}

export function logosDir(): string {
  const dir = path.join(userDir(), "logos");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Logos shipped with the app (extraResources in a build, the Swift folder in dev). */
export function bundledLogosDir(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "logos");
  return path.join(app.getAppPath(), "menubar", "Resources", "logos");
}

export function swiftLaunchAgentPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", "com.krsimmons.tickr.plist");
}
