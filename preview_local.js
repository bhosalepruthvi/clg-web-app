// Serve the built app locally, including service-worker/offline behavior.
// This does not enable production mode or deploy anything.
process.env.SERVE_FRONTEND = '1';
require('./server_studyflow_v2').start().catch(error => {
  console.error('Could not start local preview:', error.message);
  process.exitCode = 1;
});
