/**
 * Demo server.
 *
 * Deliberately not a build step, and deliberately separate from the test server in
 * tests/browser/. That one hardcodes its fixture as `/` and its module path as
 * `/src/js/`, both of which are right for a test and wrong for a site -- bending
 * either would mean the demo was being served by code shaped around assertions.
 *
 * What it does:
 *   - serves dist/future-css.css, so the demo shows the built artifact
 *   - serves src/js/*.ts with types stripped, so the bindings run as the package
 *     actually ships them: no bundler, no transpiler, no WASM
 *
 * Node's own stripTypeScriptTypes does the type removal. That is the whole reason
 * this project can claim "no build step" -- the runtime already understands enough
 * TypeScript to run it.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

/** Whether the CSS bundle has been built. */
const BUILT = existsSync(join(ROOT, "dist", "future-css.css"));

/**
 * Starts the demo server.
 *
 * @param {number} port 0 picks a free port, which is what the tests want.
 * @returns {Promise<{origin: string, close: () => Promise<void>, port: number}>}
 */
export async function startDemoServer(port = 0) {
  const server = createServer(async (req, res) => {
    const url = (req.url ?? "/").split("?")[0];

    const send = (status, type, body) => {
      res.writeHead(status, {
        "content-type": type,
        // The demo must never be embedded or used to derive a page state, and it
        // is served over http so the sandboxed iframe still sees an opaque origin.
        "x-content-type-options": "nosniff",
      });
      res.end(body);
    };

    try {
      // Bindings: real TypeScript, types removed at serve time.
      if (url.startsWith("/src/js/")) {
        const name = url.slice("/src/js/".length).replace(/\.js$/, "");
        const ts = await readFile(join(ROOT, "src/js", `${name}.ts`), "utf8");
        // Rewrite sibling specifiers to .js so the browser resolves them.
        const js = stripTypeScriptTypes(ts, { mode: "strip" }).replace(
          /(from\s*")(\.\/[a-z-]+)\.ts(")/g,
          "$1$2.js$3",
        );
        return send(200, TYPES[".js"], js);
      }

      // Refuse to serve anything outside the repository. A demo server that will
      // happily read /etc/passwd is a bad thing to hand someone to run locally.
      const relative = normalize(url).replace(/^(\.\.[/\\])+/, "");
      const path = relative === "/" ? "/demo/index.html" : relative;

      if (path === "/dist/future-css.css" && !BUILT) {
        return send(
          503,
          TYPES[".html"],
          "<h1>Run <code>npm run build:css</code> first.</h1>",
        );
      }

      const body = await readFile(join(ROOT, path));
      return send(200, TYPES[extname(path)] ?? "text/plain; charset=utf-8", body);
    } catch {
      return send(404, TYPES[".html"], "<h1>404 &mdash; not found</h1>");
    }
  });

  // Port 0 lets the OS choose, which is what the fallback needs.
  const listen = (candidate) =>
    new Promise((resolve, reject) => {
      const onError = (err) => {
        server.off("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(candidate, "127.0.0.1");
    });

  try {
    await listen(port);
  } catch (err) {
    // A stale `npm run demo` is the common case, and a raw EADDRINUSE stack
    // trace is a poor way to learn that. Falling through to an OS-assigned port
    // also means a second demo can run for reviewing a branch while the first is
    // still open, which is the situation that produces this error in the first place.
    if (err.code !== "EADDRINUSE") throw err;
    await listen(0);
  }

  const actual = server.address().port;

  return {
    origin: `http://127.0.0.1:${actual}`,
    port: actual,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// Run directly: `npm run demo`. Port 5178, or the next free port if it is taken.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const { origin, port } = await startDemoServer(Number(process.env.PORT ?? 5178));
  if (port !== 5178) {
    console.log(`  note: 5178 is in use, using ${port} instead.`);
  }
  console.log(`\n  future-css demo\n\n  ${origin}\n`);
  console.log("  Ctrl+C to stop.\n");
}