import { createServer, request as httpRequest } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("./", import.meta.url);
const values = {};
try {
  for (const line of (await readFile(new URL(".env", root), "utf8")).split(/\r?\n/)) {
    const match = line.match(/^\s*(SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const url = process.env.SUPABASE_URL || values.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || values.SUPABASE_PUBLISHABLE_KEY;
if (!url || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) ||
    !publishableKey || !publishableKey.startsWith("sb_publishable_")) {
  throw new Error("Set a hosted SUPABASE_URL and sb_publishable_ SUPABASE_PUBLISHABLE_KEY in .env.");
}
const port = Number(process.env.PORT || 3000);
const backendPort = Number(process.env.FINDIT_BACKEND_PORT || 8080);
for (const value of [port, backendPort]) {
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error("Ports must be between 1024 and 65535.");
}
if (port === backendPort) throw new Error("UI and C backend ports must differ.");
const assets = new Map([
  ["/", ["index.html", "text/html"]],
  ["/index.html", ["index.html", "text/html"]],
  ["/style.css", ["style.css", "text/css"]],
  ["/script.js", ["script.js", "text/javascript"]],
  ["/auth.js", ["auth.js", "text/javascript"]],
]);
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": `default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' https://fonts.googleapis.com https://cdn.jsdelivr.net; font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net; img-src 'self' data: https://images.unsplash.com; connect-src 'self' ${url}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
};
function json(response, status, value) {
  response.writeHead(status, { ...headers, "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}
const server = createServer(async (request, response) => {
  if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(request.headers.host)) {
    json(response, 403, { error: "Use the local FindIt UI address." });
    return;
  }
  if (request.headers["sec-fetch-site"] === "cross-site" ||
      (request.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(request.headers.origin))) {
    json(response, 403, { error: "Cross-site requests are not allowed." });
    return;
  }
  const path = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
  if (path === "/api/public-config" && request.method === "GET") {
    json(response, 200, { url, publishableKey });
    return;
  }
  if (path.startsWith("/api/")) {
    const proxyHeaders = { ...request.headers, host: `127.0.0.1:${backendPort}` };
    delete proxyHeaders.origin;
    const proxy = httpRequest({
      hostname: "127.0.0.1", port: backendPort, path: request.url,
      method: request.method, headers: proxyHeaders, timeout: 10000,
    }, (upstream) => {
      response.writeHead(upstream.statusCode, { ...upstream.headers, ...headers });
      upstream.pipe(response);
    });
    proxy.on("timeout", () => proxy.destroy(new Error("C backend request timed out.")));
    proxy.on("error", () => {
      if (!response.headersSent) json(response, 503, { error: "The login UI is running, but the C report server is not connected on port " + backendPort + "." });
      else response.destroy();
    });
    request.on("aborted", () => proxy.destroy());
    request.pipe(proxy);
    return;
  }
  const asset = assets.get(path);
  if (!asset || !["GET", "HEAD"].includes(request.method)) {
    json(response, 404, { error: "Not found." });
    return;
  }
  try {
    const body = await readFile(new URL(asset[0], root));
    response.writeHead(200, { ...headers, "Content-Type": `${asset[1]}; charset=utf-8` });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch (error) {
    console.error(`Cannot serve ${asset[0]}: ${error.message}`);
    json(response, 500, { error: "Website asset could not be read." });
  }
});
server.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
server.listen(port, "127.0.0.1", () => {
  console.log(`FindIt UI + email OTP: http://127.0.0.1:${port}`);
  console.log(`Reports use the existing C server on port ${backendPort}. Ctrl+C stops the UI.`);
  console.log(`Project: ${fileURLToPath(root)}`);
});
