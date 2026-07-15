import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // @noble/hashes v2 is ESM-only; the main bundle is CommonJS, so leaving it
    // external makes Node `require()` an ESM module → ERR_REQUIRE_ESM at boot.
    // Exclude it from externalization so rollup BUNDLES it (ESM→CJS) instead.
    plugins: [externalizeDepsPlugin({ exclude: ['@noble/hashes'] })],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main'),
        // Per-app backends live in their own top-level folders (siblings of frontend/).
        '@pylon': resolve('../Pylon'),
        '@devbay': resolve('../DevBay')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        // Build BOTH preloads: the main DecksApi preload (index) and the tiny
        // separate preload loaded into the JetCore Operations WebContentsView.
        // electron-vite would otherwise only build src/preload/index.ts.
        input: {
          index: resolve('src/preload/index.ts'),
          operations: resolve('src/preload/operations.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()]
  }
})
