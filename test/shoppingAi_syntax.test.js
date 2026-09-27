import test from "node:test";
import assert from "node:assert/strict";
import subprocess from "node:child_process";
import path from "node:path";
import fs from "node:fs";

test("src/shopping/shoppingAi.js compiles without syntax errors", () => {
  const filepath = path.resolve("src/shopping/shoppingAi.js");
  const result = subprocess.spawnSync("node", ["--check", filepath], { encoding: "utf8" });
  assert.equal(result.status, 0, `Syntax error in shoppingAi.js: ${result.stderr}`);
});

test("All JS files in src compile without syntax errors", () => {
  const srcDir = path.resolve("src");
  const checkDir = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        checkDir(fullPath);
      } else if (entry.isFile() && entry.name.endswith ? entry.name.endsWith(".js") : entry.name.slice(-3) === ".js") {
        const result = subprocess.spawnSync("node", ["--check", fullPath], { encoding: "utf8" });
        assert.equal(result.status, 0, `Syntax error in ${fullPath}: ${result.stderr}`);
      }
    }
  };
  checkDir(srcDir);
});
