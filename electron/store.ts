import { execFileSync } from "node:child_process";
import fs from "node:fs";
import {
  applyPrefsPatch,
  DEFAULT_PREFS,
  parseSwiftDefaultsPlist,
  sanitizePrefs,
  type Prefs,
} from "./core/prefs";
import { prefsPath } from "./paths";

/** Prefs live in one JSON file under userData. */
export class PrefsStore {
  private prefs: Prefs;
  readonly firstRun: boolean;

  constructor(private readonly file = prefsPath()) {
    let raw: unknown = null;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      raw = null;
    }
    this.firstRun = raw == null;
    this.prefs = sanitizePrefs(
      raw == null ? { ...DEFAULT_PREFS, ...importSwiftDefaults() } : raw,
    );
    if (this.firstRun) this.save();
  }

  get(): Prefs {
    return this.prefs;
  }

  update(patch: Partial<Prefs>): Prefs {
    this.prefs = applyPrefsPatch(this.prefs, patch);
    this.save();
    return this.prefs;
  }

  private save(): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.prefs, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

/** One-time carry-over of the Swift app's UserDefaults on macOS. */
function importSwiftDefaults(): Partial<Prefs> {
  if (process.platform !== "darwin") return {};
  try {
    const xml = execFileSync("defaults", ["export", "com.krsimmons.tickr", "-"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseSwiftDefaultsPlist(xml);
  } catch {
    return {};
  }
}
