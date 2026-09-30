import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { publicRouteSeo, renderRouteHtml, seoForPath } from "./src/lib/routeSeo";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

// Static production hosting has no application server. Emit an HTML shell per
// public route so social crawlers see the right head without running JavaScript.
// Private and tokenized pages get a dedicated noindex shell.
function routeHtmlPlugin(): Plugin {
  return {
    name: "route-html",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url ?? "/", "http://localhost").pathname.replace(/\/+$/, "") || "/";
        if (pathname === "/" || !(/^(\/(?:admin|jobs|s|image|podcast)\/)/.test(pathname) ||
          pathname in publicRouteSeo || ["/signup", "/editor", "/dashboard", "/prompt-studio", "/settings",
            "/redeem", "/forgot-password", "/reset-password", "/admin", "/suite", "/podcast"].includes(pathname))) {
          next();
          return;
        }
        try {
          const html = readFileSync(path.resolve(import.meta.dirname, "index.html"), "utf8");
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(await server.transformIndexHtml(pathname, renderRouteHtml(html, seoForPath(pathname))));
        } catch (error) {
          next(error);
        }
      });
    },
    writeBundle(options) {
      const outDir = options.dir;
      if (!outDir) throw new Error("Missing Vite output directory");
      const indexPath = path.join(outDir, "index.html");
      const html = readFileSync(indexPath, "utf8");
      const writeRoute = (file: string, content: string) => {
        const destination = path.join(outDir, file);
        mkdirSync(path.dirname(destination), { recursive: true });
        writeFileSync(destination, content);
      };
      writeRoute("index.html", renderRouteHtml(html, publicRouteSeo["/"]));
      for (const [route, seo] of Object.entries(publicRouteSeo)) {
        if (route === "/") continue;
        writeRoute(`seo${route}.html`, renderRouteHtml(html, seo));
        writeRoute(`${route.slice(1)}/index.html`, renderRouteHtml(html, seo));
      }
      writeRoute("signup/index.html", renderRouteHtml(html, publicRouteSeo["/register"]));
      for (const route of ["/dashboard", "/editor", "/settings", "/prompt-studio", "/forgot-password",
        "/reset-password", "/redeem", "/admin", "/podcast", "/suite"]) {
        const privateHtml = renderRouteHtml(html, seoForPath(route));
        writeRoute(`${route.slice(1)}/index.html`, privateHtml);
        writeRoute(`seo${route}.html`, privateHtml);
      }
      // Tokenized/private IDs cannot have a known canonical at build time.
      // Omit URL hints instead of incorrectly canonicalizing every job to dashboard.
      writeRoute("seo/private.html", renderRouteHtml(html, seoForPath("/dashboard"))
        .replace(/\s*<link rel="canonical"[^>]*>/, "")
        .replace(/\s*<meta property="og:url"[^>]*>/, ""));
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    routeHtmlPlugin(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
