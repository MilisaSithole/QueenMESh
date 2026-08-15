// Run every *.test.js in this folder.
//
//   node tests/run.js
//
// Exits non-zero on failure, so it can gate a commit or a CI step later.

const fs = require('fs');
const path = require('path');
const { state } = require('./harness');

const files = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

for (const file of files) require(path.join(__dirname, file));

console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
