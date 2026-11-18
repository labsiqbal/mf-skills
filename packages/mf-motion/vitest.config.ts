import { defineConfig } from 'vitest/config';

// Two projects: `unit` (unit, contract, CLI integration and agent-flow tests,
// parallel) and `render` (anything that drives the render engine, strictly
// serial: one file at a time in one worker).
export default defineConfig({
  test: {
    // The root setup runs once, including when only one project is selected.
    globalSetup: './test/helpers/global-setup.ts',
    projects: [
      {
        test: {
          name: 'unit',
          include: [
            'test/unit/**/*.test.ts',
            'test/integration/**/*.test.ts',
            'test/agent-flows/**/*.test.ts',
          ],
          environment: 'node',
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: 'render',
          include: ['test/render/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          maxWorkers: 1,
          testTimeout: 600_000,
          hookTimeout: 600_000,
        },
      },
    ],
  },
});
