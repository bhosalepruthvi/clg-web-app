// Idempotent, additive Oracle migration. Does not modify existing credentials.
const oracle = require('oracledb');
(async () => {
  const dir = process.env.TNS_ADMIN;
  const connection = await oracle.getConnection({ user: process.env.ORACLE_USER || 'ADMIN', password: process.env.ORACLE_PASSWORD, connectString: process.env.ORACLE_CONNECT_STRING, configDir: dir, walletLocation: dir, walletPassword: process.env.ORACLE_WALLET_PASSWORD });
  try {
    for (const [sql, allowed] of [
      ['ALTER TABLE students ADD (email VARCHAR2(255))', 1430],
      ['ALTER TABLE students ADD (registration_code VARCHAR2(40))', 1430],
      ['CREATE UNIQUE INDEX uq_student_email ON students (LOWER(email))', 955],
      ['CREATE UNIQUE INDEX uq_student_registration ON students (registration_code)', 955],
    ]) { try { await connection.execute(sql); } catch (e) { if (e.errorNum !== allowed) throw e; } }
    console.log('Student registration migration complete. Existing accounts preserved.');
  } finally { await connection.close(); }
})().catch(e => { console.error('Migration failed:', e.message); process.exitCode = 1; });
