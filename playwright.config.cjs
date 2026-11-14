const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "test/ui",
  testMatch: "**/*.spec.cjs",
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  use: {
    browserName: "firefox",
    headless: true,
    viewport: { width: 1240, height: 860 },
  },
  reporter: "list",
  outputDir: ".test-output/playwright",
});
