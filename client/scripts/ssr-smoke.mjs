// client/scripts/ssr-smoke.mjs
// Renders every page with react-dom/server through Vite's SSR pipeline.
// This catches component-level mistakes (bad imports, undefined references,
// invalid JSX) without needing a browser. Data fetching happens in useEffect,
// which SSR does not run, so the pages render their loading states.
//
// Usage:  cd client && npm run smoke:pages

import { createServer } from 'vite';

const ROUTES = [
  ['/', 'SearchPage'],
  ['/dashboard', 'DashboardPage'],
  ['/products/00000000-0000-0000-0000-000000000000', 'ProductDetailPage'],
];

const vite = await createServer({
  // The project vite.config.js is loaded on purpose: it registers
  // @vitejs/plugin-react, which supplies the automatic JSX runtime.
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});

let failures = 0;

try {
  const { renderToString } = await import('react-dom/server');
  const { StaticRouter } = await import('react-router-dom/server.js');
  const ReactModule = await import('react');
  const React = ReactModule.default ?? ReactModule;

  const App = (await vite.ssrLoadModule('/src/App.jsx')).default;

  for (const [route, expected] of ROUTES) {
    try {
      const html = renderToString(
        React.createElement(StaticRouter, { location: route }, React.createElement(App))
      );
      const ok = typeof html === 'string' && html.length > 0;
      console.log(
        `[${ok ? 'PASS' : 'FAIL'}] rendered ${expected} at ${route} (${html.length} chars of HTML)`
      );
      if (!ok) failures += 1;
    } catch (err) {
      failures += 1;
      console.log(`[FAIL] ${expected} at ${route}: ${err.message}`);
    }
  }
} catch (err) {
  failures += 1;
  console.log(`[FAIL] SSR harness error: ${err.message}`);
} finally {
  await vite.close();
}

console.log(failures ? `\n${failures} page(s) failed to render.` : '\nAll pages rendered successfully.');
process.exitCode = failures ? 1 : 0;
