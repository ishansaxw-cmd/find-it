import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";

let child;
let base;

async function unusedPort() {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

before(async () => {
  const port = await unusedPort();
  const backendPort = await unusedPort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["start-ui.mjs"], {
    cwd: new URL("../", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      FINDIT_BACKEND_PORT: String(backendPort),
      SUPABASE_URL: "https://test-project.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      SUPABASE_SECRET_KEY: "not-for-the-browser",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  child.stderr.on("data", (chunk) => { errors += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("UI server did not start.")), 5000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`UI server exited (${code}): ${errors}`));
    });
    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("FindIt UI + email OTP:")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
});

after(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }
});

test("configuration exposes only public URL and publishable key", async () => {
  const response = await fetch(`${base}/api/public-config`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    url: "https://test-project.supabase.co",
    publishableKey: "sb_publishable_test",
  });
  assert.match(response.headers.get("content-security-policy"), /connect-src 'self' https:\/\/test-project\.supabase\.co/);
});

test("private files are not served", async () => {
  for (const path of ["/.env", "/.env.example", "/c/server.c", "/data/findit.db", "/start-ui.mjs"]) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
});

test("UI and login assets are available", async () => {
  for (const path of ["/", "/auth.js", "/script.js", "/style.css"]) {
    assert.equal((await fetch(base + path)).status, 200, path);
  }
});

test("cross-site requests are blocked", async () => {
  const response = await fetch(`${base}/api/public-config`, {
    headers: { Origin: "https://example.com" },
  });
  assert.equal(response.status, 403);
});

test("disconnected C backend gives an explicit error", async () => {
  const response = await fetch(`${base}/api/items`);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /C report server is not connected/);
});
