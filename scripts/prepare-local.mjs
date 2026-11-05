import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const descriptors = resolve(app, "../descriptors");
const jade = resolve(app, "../jade");
const packages = join(app, ".local/packages");

function npm(directory, ...args) {
  execFileSync("npm", args, { cwd: directory, stdio: "inherit" });
}

mkdirSync(packages, { recursive: true });
npm(descriptors, "run", "build");
npm(jade, "run", "build");

const preset = join(descriptors, "packages/descriptors");
for (const name of ["README.md", "HARDWARE_WALLETS.md"]) {
  copyFileSync(join(descriptors, name), join(preset, name));
}
for (const directory of [
  descriptors,
  preset,
  join(jade, "packages/jade"),
  join(jade, "packages/jade-react-native"),
]) {
  npm(directory, "pack", "--pack-destination", packages);
}

// Explicit tarball arguments refresh same-version builds and their integrity
// hashes instead of keeping an older cached 3.3.0/0.1.0 installation.
npm(
  app,
  "install",
  "--no-audit",
  "--no-fund",
  "./.local/packages/bitcoinerlab-descriptors-core-3.3.0.tgz",
  "./.local/packages/bitcoinerlab-descriptors-3.3.0.tgz",
  "./.local/packages/bitcoinerlab-jade-0.1.0.tgz",
  "./.local/packages/bitcoinerlab-jade-react-native-0.1.0.tgz",
);
