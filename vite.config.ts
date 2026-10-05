import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import path, { resolve } from 'path'
import packageJson from './package.json'

const host = process.env.TAURI_DEV_HOST

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  plugins: [
    react(),
    babel({
      presets: [reactCompilerPreset()],
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 600, // Prevent warnings for template's bundled components
    rolldownOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        // v1.3.0 (#56): the help center's own minimal webview page — the
        // second window must not boot the whole main app shell.
        help: resolve(__dirname, 'help.html'),
        // v1.5.0 (#129): the projection window's thin root — same
        // multi-page pattern, no AppShell boots on the venue screen.
        projection: resolve(__dirname, 'projection.html'),
      },
    },
  },
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    // WKWebView (both app windows) caches dev modules aggressively and
    // has served stale CSS/JS after an HMR connection silently died
    // (occluded webviews drop the socket) — and ⌘R CANNOT reload them
    // because the app menu binds it to 重命名 (menu.ts §v1.1.2 T6). A
    // real reload must never be answered from cache.
    headers: { 'Cache-Control': 'no-store' },
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Backend files and standalone docs/prototypes are not App modules.
      // HTML edits under docs otherwise emit full-reload notifications mid-show.
      // Help content is read by Rust on demand; it does not depend on Vite HMR.
      ignored: ['**/src-tauri/**', '**/docs/**'],
    },
  },
}))
