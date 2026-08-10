import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const bundleDir = join(root, "src-tauri", "target", "release", "bundle", "nsis");
const deployDir = join(root, "deploy");
const baseUrl = process.env.UPDATE_BASE_URL || "https://snippetspot.netlify.app";

const conf = JSON.parse(
  readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8")
);
const version = conf.version;

const fileName = `SnippetSpot_${version}_x64-setup.exe`;
const exePath = join(bundleDir, fileName);
const sigPath = join(bundleDir, `${fileName}.sig`);

try {
  readFileSync(exePath);
  const signature = readFileSync(sigPath, "utf8").trim();

  const manifest = {
    version,
    notes: "",
    pub_date: new Date().toISOString(),
    platforms: {
      "windows-x86_64": {
        signature,
        url: `${baseUrl}/${fileName}`,
      },
    },
  };

  mkdirSync(deployDir, { recursive: true });
  copyFileSync(exePath, join(deployDir, fileName));
  copyFileSync(sigPath, join(deployDir, `${fileName}.sig`));
  writeFileSync(join(deployDir, "latest.json"), JSON.stringify(manifest, null, 2));

  console.log(`Staged v${version} updater files into ${deployDir}:`);
  console.log(`  - ${fileName}`);
  console.log(`  - ${fileName}.sig`);
  console.log(`  - latest.json`);
  console.log(`Manifest URL: ${baseUrl}/latest.json`);
} catch (err) {
  console.error(`Publish failed: ${err.message}`);
  console.error(`Make sure ${exePath} and ${sigPath} exist (run a signed build first).`);
  process.exit(1);
}
