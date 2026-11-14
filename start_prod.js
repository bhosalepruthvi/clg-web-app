/**
 * start_prod.js — production entry point for the StudyFlow v2 stack.
 * Enables static serving of the built React SPA, then starts the server.
 * Requires react-frontend/dist to exist (run "npm run build:frontend" first).
 */
process.env.SERVE_FRONTEND = '1';
process.env.NODE_ENV = 'production';
require('./server_studyflow_v2.js').start().catch(error => {
  console.error('Startup failed:', error.message);
  process.exitCode = 1;
});
