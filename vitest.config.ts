import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

const alias = { '@': path.resolve(import.meta.dirname, 'src') }

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          globals: true,
          include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
          setupFiles: ['./tests/setup.ts'],
          css: false,
        },
      },
      {
        // Real PostgreSQL (PGlite, WebAssembly): migrations, grants, RLS, triggers, constraints.
        extends: true,
        test: {
          name: 'db',
          environment: 'node',
          globals: true,
          include: ['tests/db/**/*.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
})
