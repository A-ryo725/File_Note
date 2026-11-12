// Runs the tests in the installed Chrome instead of Playwright's downloaded Chromium:
//   npx playwright test --config playwright.chrome.config.js
import base from './playwright.config.js';

export default { ...base, use: { ...base.use, channel: 'chrome' } };
