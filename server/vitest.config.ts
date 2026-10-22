import { defineConfig } from 'vitest/config'

// tests use their own database so they never touch your real data
export default defineConfig({
    test: {
        env: {
            NODE_ENV: 'test',
            DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/formcheck_test',
            JWT_SECRET: 'test-secret',
        },
        fileParallelism: false,
    },
})
