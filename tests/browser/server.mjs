/**
 * A minimal server for the browser binding tests.
 *
 * Serves the fixture, the built stylesheet, and the *real* TypeScript sources with
 * types stripped. Serving the sources directly is deliberate: it proves the
 * bindings work as the package actually ships them, with no bundler, no
 * transpiler, and no Rust or WASM toolchain -- which is the property this
 * project cares most about.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  // The bindgen glue falls back from streaming when the type is wrong, but the
  // right type is one line and the wrong one hides a real server mistake.
  ".wasm": "application/wasm",
};

/** Starts the server and returns its origin. */
export async function startServer() {
  const server = createServer(async (req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    const send = (status, type, body) => {
      res.writeHead(status, { "content-type": type });
      res.end(body);
    };

    try {
      if (url.startsWith("/src/js/")) {
        const name = url.slice("/src/js/".length).replace(/\.js$/, "");
        const ts = await readFile(join(ROOT, "src/js", `${name}.ts`), "utf8");
        // Rewrite sibling specifiers so the browser resolves them as .js.
        const js = stripTypeScriptTypes(ts, { mode: "strip" }).replace(
          /(from\s*")(\.\/[a-z-]+)\.ts(")/g,
          "$1$2.js$3",
        );
        return send(200, TYPES[".js"], js);
      }

      const path = url === "/" ? "/tests/browser/fixture.html" : url;
      const body = await readFile(join(ROOT, path));
      return send(200, TYPES[extname(path)] ?? "text/plain", body);
    } catch (err) {
      return send(404, "text/plain", String(err));
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Common Chrome install locations, in preference order. */
const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/**
 * Locates a Chrome binary, or returns null.
 *
 * A missing browser skips the suite rather than failing it: the zero-dependency
 * property means this repo must stay installable on a machine with no browser,
 * and a test suite that hard-requires one would break that.
 */
export async function findChrome() {
  for (const path of CHROME_CANDIDATES) {
    if (existsSync(path)) return path;
  }
  return null;
}
