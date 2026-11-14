// @ts-check
const { defineConfig, devices } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './e2e', timeout: 45000, expect: {timeout:10000}, fullyParallel: false, workers:1,
  reporter:[['list'],['html',{open:'never',outputFolder:'playwright-report'}]],
  use:{baseURL:'http://localhost:4173',trace:'retain-on-failure',screenshot:'only-on-failure'},
  projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'android',use:{...devices['Pixel 5']}}],
  webServer:{command:'node e2e/serve.cjs',url:'http://localhost:4173/api/health',reuseExistingServer:false,timeout:30000}
});
