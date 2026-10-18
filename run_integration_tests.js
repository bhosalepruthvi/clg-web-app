/**
 * Runs the v2 suite including the live-Oracle integration test.
 * Requires ORACLE_USER / ORACLE_PASSWORD / ORACLE_CONNECT_STRING (and
 * TNS_ADMIN for the wallet) to be set, and MUTATES the database.
 */
process.env.RUN_DB_INTEGRATION = '1';
const { run } = require('node:test');
run({ files: ['test_studyflow_v2.js'] }).on('test:fail', () => {
  process.exitCode = 1;
});
