'use strict';
// Creates only missing objects from the reviewed StudyFlow schema files.
// Existing objects and records are preserved; --check performs no DDL.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const oracle = require('oracledb');
const files = ['schema_studyflow_v2.sql', 'migrations/2026_campus.sql',
  'migrations/2026_discussions.sql', 'migrations/2026_learning.sql'];

async function main() {
  const statements = files.flatMap(file => fs.readFileSync(path.join(__dirname, file), 'utf8')
    .replace(/--[^\r\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean));
  const objects = statements.map(sql => {
    const match = /^CREATE (TABLE|INDEX) (\w+)\s*\(/i.exec(sql) || /^CREATE (INDEX) (\w+)\s+ON\s/i.exec(sql);
    if (!match) throw new Error('Unsupported schema statement; review required.');
    return { sql, type: match[1].toUpperCase(), name: match[2].toUpperCase() };
  });
  if (!process.env.ORACLE_PASSWORD) throw new Error('Set ORACLE_PASSWORD in .env first.');
  const wallet = path.resolve(__dirname, process.env.TNS_ADMIN || 'wallet');
  const connection = await oracle.getConnection({
    user: process.env.ORACLE_USER || 'ADMIN', password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECT_STRING || 'studyflow_high',
    configDir: wallet, walletLocation: wallet, walletPassword: process.env.ORACLE_WALLET_PASSWORD
  });
  try {
    for (const object of objects) {
      const existing = await connection.execute(
        'SELECT object_type FROM user_objects WHERE object_name = :name', { name: object.name });
      if (!existing.rows.some(row => row[0] === object.type)) {
        // UNIQUE constraints already provide two of the schema's indexes.
        const index = /^CREATE INDEX \w+ ON (\w+)\s*\(([^)]+)\)$/i.exec(object.sql);
        let equivalent = false;
        if (index && /^[\w\s,]+$/.test(index[2])) {
          const columns = index[2].split(',').map(s => s.trim().toUpperCase()).join(',');
          const indexes = await connection.execute(
            "SELECT index_name, LISTAGG(column_name, ',') WITHIN GROUP (ORDER BY column_position) FROM user_ind_columns WHERE table_name = :name GROUP BY index_name",
            { name: index[1].toUpperCase() });
          equivalent = indexes.rows.some(row => row[1] === columns);
        }
        if (!equivalent) {
          if (process.argv.includes('--check')) throw new Error(`Missing ${object.type}: ${object.name}`);
          await connection.execute(object.sql);
          console.log(`Created ${object.type}: ${object.name}`);
        }
      }
      if (object.type === 'TABLE') await connection.execute(`SELECT * FROM ${object.name} WHERE 1 = 0`);
    }
    console.log('Oracle schema verified: 10 StudyFlow tables and their indexes are available.');
  } finally { await connection.close(); }
}
main().catch(error => {
  // Do not print credentials, connection descriptors, or wallet contents.
  console.error(error.code ? `Oracle setup failed (${error.code}).` : error.message);
  process.exitCode = 1;
});
