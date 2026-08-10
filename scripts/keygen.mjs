import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = join(__dirname, "license-keys");
const PRIVATE_PEM = join(KEYS_DIR, "private.pem");
const SEED_FILE = join(KEYS_DIR, "private.seed");
const PUBLIC_FILE = join(KEYS_DIR, "public.hex");
const LICENSE_RS = join(__dirname, "..", "src-tauri", "src", "license.rs");
const PREFIX = "SS1-";

const usage = `SnippetSpot license keygen

  node scripts/keygen.mjs gen [--force]
      Generate a new Ed25519 signing keypair into scripts/license-keys/.
      Prints the public key hex to embed as LICENSE_PUBLIC_KEY in license.rs.

  node scripts/keygen.mjs issue <email> [--full | --renew] [--days N]
      Issue a signed license key for an email.
      --full    fixed-period full license (default 1 year, override with --days N)
      --renew   14-day renewal license
      default   standard license (default 1 year; --permanent for no expiry)
      Output: a key that starts with ${PREFIX}

  node scripts/keygen.mjs check <key>
      Verify a key against the public key embedded in license.rs.

  node scripts/keygen.mjs pub
      Print the current public key hex.

Private key material stays under scripts/license-keys/ and is never shipped.
`;

function rawPublic(pem) {
  const der = createPublicKey(pem).export({ type: "spki", format: "der" });
  return der.subarray(der.length - 32).toString("hex");
}

function seedFromPem(pem) {
  const der = createPrivateKey(pem).export({ type: "pkcs8", format: "der" });
  return der.subarray(der.length - 32).toString("hex");
}

function embeddedPublic() {
  const src = readFileSync(LICENSE_RS, "utf8");
  const m = src.match(/LICENSE_PUBLIC_KEY: \[u8; 32\] = \[([^\]]+)\]/);
  if (!m) throw new Error("LICENSE_PUBLIC_KEY not found in license.rs");
  const bytes = m[1]
    .replace(/0x/g, "")
    .replace(/[^0-9a-fA-F]/g, "")
    .match(/.{2}/g)
    .map((h) => parseInt(h, 16));
  return Buffer.from(bytes);
}

function issue(email, days, tier, permanent) {
  if (!existsSync(PRIVATE_PEM)) throw new Error("Run gen first");
  const pem = readFileSync(PRIVATE_PEM);
  let expires;
  if (tier === "full") {
    expires = new Date(Date.now() + (days ?? 365) * 86400000).toISOString();
  } else if (tier === "renew") {
    expires = new Date(Date.now() + 14 * 86400000).toISOString();
  } else {
    expires = permanent
      ? null
      : new Date(Date.now() + (days ?? 365) * 86400000).toISOString();
  }
  const payload = {
    email,
    tier,
    issuedAt: new Date().toISOString(),
    expiresAt: expires,
  };
  const body = Buffer.from(JSON.stringify(payload));
  const sig = sign(null, body, pem);
  const raw = Buffer.concat([sig, body]);
  return PREFIX + raw.toString("base64url");
}

function check(key) {
  if (!key.startsWith(PREFIX)) throw new Error("Not a SnippetSpot key");
  const raw = Buffer.from(key.slice(PREFIX.length), "base64url");
  if (raw.length < 64) throw new Error("Key too short");
  const sig = raw.subarray(0, 64);
  const body = raw.subarray(64);
  const pub = embeddedPublic();
  const spki = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    pub,
  ]);
  const publicKey = createPublicKey({ key: spki, format: "der", type: "spki" });
  if (!verify(null, body, publicKey, sig)) throw new Error("Signature invalid");
  const payload = JSON.parse(body.toString());
  if (payload.expiresAt && new Date(payload.expiresAt).getTime() < Date.now()) {
    throw new Error("Key expired " + payload.expiresAt);
  }
  return payload;
}

const [cmd, a] = process.argv.slice(2);

if (!cmd) {
  console.log(usage);
} else if (cmd === "gen") {
  if (existsSync(PRIVATE_PEM) && !a) {
    throw new Error("Keypair already exists. Pass --force to overwrite.");
  }
  mkdirSync(KEYS_DIR, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  const pem = createPrivateKey({
    key: privateKey,
    format: "der",
    type: "pkcs8",
  }).export({ type: "pkcs8", format: "pem" });
  writeFileSync(PRIVATE_PEM, pem);
  writeFileSync(SEED_FILE, seedFromPem(pem) + "\n");
  writeFileSync(PUBLIC_FILE, rawPublic(pem) + "\n");
  console.log("Wrote " + PRIVATE_PEM);
  console.log("Public key hex (paste into LICENSE_PUBLIC_KEY in license.rs):");
  console.log(rawPublic(pem));
} else if (cmd === "issue") {
  if (!a) throw new Error("Missing <email>");
  const full = process.argv.includes("--full");
  const renew = process.argv.includes("--renew");
  const permanent = process.argv.includes("--permanent");
  if (full && renew) throw new Error("--full and --renew are mutually exclusive");
  const daysArg = process.argv.indexOf("--days");
  const days = daysArg !== -1 ? Number(process.argv[daysArg + 1]) : 365;
  const tier = full ? "full" : renew ? "renew" : "standard";
  console.log(issue(a, Number.isFinite(days) ? days : 365, tier, permanent));
} else if (cmd === "check") {
  if (!a) throw new Error("Missing <key>");
  console.log(JSON.stringify(check(a), null, 2));
} else if (cmd === "pub") {
  if (!existsSync(PRIVATE_PEM)) throw new Error("Run gen first");
  console.log(rawPublic(readFileSync(PRIVATE_PEM)));
} else {
  console.log(usage);
}
