// Tiny test harness. No dependencies, no build step — same constraints as the
// game itself, so `node tests/run.js` works on a clean checkout.

const state = { pass: 0, fail: 0 };

function suite(name) {
  console.log('\n' + name);
}

function test(name, fn) {
  try {
    fn();
    console.log('  ok    ' + name);
    state.pass++;
  } catch (error) {
    console.log('  FAIL  ' + name);
    console.log('        ' + String(error.message).replace(/\n/g, '\n        '));
    state.fail++;
  }
}

/** Print a measured value alongside a test, for numbers worth seeing pass. */
function note(message) {
  console.log('        ' + message);
}

function eq(got, want, what) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(
      `${what || 'mismatch'}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`
    );
  }
}

function ok(condition, message) {
  if (!condition) throw new Error(message || 'expected a truthy value');
}

module.exports = { suite, test, note, eq, ok, state };
