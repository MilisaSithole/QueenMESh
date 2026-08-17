// Command line for generator.js — prints one board per requested size.
//
//   node tools/generate-puzzle.js 7            one 7x7
//   node tools/generate-puzzle.js 6 7 8 9      one of each

const { generate, MIN_SIZE, MAX_SIZE } = require('../generator');

function preview(size, regions, solution) {
  const lines = [];
  for (let r = 0; r < size; r++) {
    lines.push('  ' + regions[r].map((v, c) => (solution[r] === c ? `(${v})` : ` ${v} `)).join(''));
  }
  return lines.join('\n');
}

const sizes = process.argv.slice(2).map(Number);
if (!sizes.length || sizes.some((n) => !Number.isInteger(n) || n < MIN_SIZE || n > MAX_SIZE)) {
  console.error(`usage: node tools/generate-puzzle.js <size ${MIN_SIZE}-${MAX_SIZE}> [more sizes...]`);
  process.exit(1);
}

for (const size of sizes) {
  const started = Date.now();
  const { best: result, stats } = generate(size);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (!result) {
    console.log(`\n${size}x${size}: no board met the balance criteria (${seconds}s)`);
    console.log(`  ${stats.arrangements} arrangements, ${stats.grown} layouts grown, ` +
      `${stats.unique} reached a unique solution`);
    console.log(`  criteria were: every region ${stats.smallest}-${stats.largest} cells`);
    continue;
  }

  console.log(`\n${'='.repeat(64)}`);
  console.log(`${size}x${size}  —  ${stats.arrangements} arrangements, ${stats.grown} layouts grown, ` +
    `${stats.unique} unique, best spread ${result.spread}  (${seconds}s)`);
  console.log(`region sizes ${result.sizes.join(',')}  total ${result.sizes.reduce((a, b) => a + b)}`);
  console.log();
  console.log(preview(size, result.regions, result.solution));
  console.log();
  console.log('    regions: [');
  console.log(result.regions.map((row) => `      [${row.join(', ')}],`).join('\n'));
  console.log('    ],');
  console.log(`    solution: [${result.solution.join(', ')}],`);
}
