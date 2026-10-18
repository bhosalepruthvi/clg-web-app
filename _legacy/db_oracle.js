/**
 * db_oracle.js
 * Oracle Autonomous Database connection pool setup using the `oracledb` driver.
 *
 * Requirements:
 * - npm install oracledb
 * - Wallet zip downloaded from Oracle Cloud console and extracted to /wallet folder
 */

const oracledb = require('oracledb');
const path = require('path');

// Tell oracledb where the Oracle Cloud Wallet files (tnsnames.ora, cwallet.sso) live
const WALLET_DIR = process.env.TNS_ADMIN || path.join(__dirname, 'wallet');
if (process.env.TNS_ADMIN) {
  try {
    oracledb.initOracleClient({ configDir: WALLET_DIR });
  } catch (err) {
    // Thin mode fallback (oracledb 6+ supports pure JS thin mode without instant client)
  }
}

let pool = null;

async function initOraclePool() {
  if (pool) return pool;

  pool = await oracledb.createPool({
    user: process.env.ORACLE_USER || 'ADMIN',
    password: process.env.ORACLE_PASSWORD || 'YourPassword123#',
    connectString: process.env.ORACLE_CONNECT_STRING || 'studyflow_high', // Service name from tnsnames.ora
    poolMin: 2,
    poolMax: 10,
    poolIncrement: 2
  });

  console.log('✅ Oracle Autonomous Database Connection Pool Initialized.');
  return pool;
}

async function executeQuery(sql, binds = [], options = {}) {
  let conn;
  try {
    if (!pool) await initOraclePool();
    conn = await pool.getConnection();
    const result = await conn.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      autoCommit: true,
      ...options
    });
    return result;
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

module.exports = {
  initOraclePool,
  executeQuery
};
