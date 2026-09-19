// Prints an ADMIN_PASSWORD_HASH value for the password read from stdin (never from argv, so it stays out of shell
// history and process lists). Usage:  npm run admin:hash-password   (type the password, press Enter)
import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: false });
process.stderr.write("Admin password (min 16 characters), then Enter: ");
rl.once("line", (line) => {
  rl.close();
  const password = line.replace(/\r$/, "");
  if (password.length < 16) {
    process.stderr.write("\nRefused: use at least 16 characters.\n");
    process.exit(1);
  }
  // Same parameters and format as lib/admin/password.ts (hashPassword).
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  process.stderr.write("\nSet this as ADMIN_PASSWORD_HASH in the server environment (not in Git):\n");
  process.stdout.write(`scrypt:16384:8:1:${salt.toString("base64url")}:${key.toString("base64url")}\n`);
});
