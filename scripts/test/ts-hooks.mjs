// Lets `node --test` import the app's TypeScript modules directly.
//
//   node --import ./scripts/test/ts-hooks.mjs --test <file.test.mjs>
//
// Node strips TypeScript types itself (22.18+ / 23.6+); what it cannot do is
// resolve the specifiers the app is written with, which the Next.js bundler
// normally resolves: extensionless relative imports ("./taxonomy") and the
// "@/…" path alias from tsconfig.json. This resolve hook maps both to the .ts
// file on disk. Nothing else is transformed; modules that import "server-only"
// or Next.js runtime APIs are still not importable here, by design.
import * as nodeModule from "node:module";
import { existsSync } from "node:fs";

const { registerHooks } = nodeModule;
if (typeof registerHooks !== "function" || !process.features?.typescript) {
  throw new Error(`These tests need Node 22.18+ (type stripping and module.registerHooks); this is ${process.version}.`);
}

const root = new URL("../../", import.meta.url);
const EXTENSIONS = [".ts", ".tsx", "/index.ts"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    const target = specifier.startsWith("@/")
      ? new URL(specifier.slice(2), root)
      : specifier.startsWith("./") || specifier.startsWith("../")
        ? new URL(specifier, context.parentURL)
        : null;
    if (target && !/\.[cm]?[jt]sx?$/.test(target.pathname)) {
      for (const ext of EXTENSIONS) {
        const candidate = new URL(target.href + ext);
        if (existsSync(candidate)) return nextResolve(candidate.href, context);
      }
    }
    return nextResolve(target ? target.href : specifier, context);
  },
});
