import { defineConfig } from 'tsdown';

// WP-0.1: minimal host-side entry. The real client bundle config
// (tsdown clientBundle preset) lands with the WP-0.5 client surface.
export default defineConfig({
  entry: ['./src/host/index.ts'],
});
