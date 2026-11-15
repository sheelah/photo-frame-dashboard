import { defineConfig } from 'vite';

// The frame runs Android WebView 106. CSS targets chrome61 for the same reason as dashboard/:
// that WebView rejects 4/8-digit hex colours, which a newer target lets the minifier emit.
export default defineConfig({
  build: {
    target: 'chrome106',
    cssTarget: 'chrome61',
  },
});
