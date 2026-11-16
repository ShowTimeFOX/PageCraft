// Runs Vitest from the canonical project path.
// On Windows, a lowercase drive letter (e:\ instead of E:\, as VS Code often opens folders)
// makes Node load Vitest twice and every suite fails with "failed to find the current suite".
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";

const root = realpathSync.native(process.cwd());
const result = spawnSync(process.execPath, [join(root, "node_modules/vitest/vitest.mjs"), ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
