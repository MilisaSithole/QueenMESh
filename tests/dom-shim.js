// A DOM small enough to hand-roll and real enough to run the actual game code.
//
// The point is to exercise main.js itself rather than a reimplementation of it
// in the tests — a copy of the logic would happily agree with itself while the
// shipped file was broken. Only the handful of APIs main.js touches are
// implemented.
//
// Cells are laid out on a notional grid where cell (row, col) occupies
// x = col*CELL .. +CELL and y = row*CELL .. +CELL, which is what lets
// elementFromPoint resolve a coordinate back to a cell the way a browser would.

const fs = require('fs');
const path = require('path');

const CELL = 10;
const ROOT = path.join(__dirname, '..');

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this.attrs = {};
    this.textContent = '';
    this._class = '';
    this.style = { setProperty: (key, value) => { this.attrs[key] = value; } };
    this.listeners = {};
    this.captured = new Set();
  }

  set className(value) { this._class = value; }
  get className() { return this._class; }

  get classList() {
    return {
      add: (...names) => { this._class = (this._class + ' ' + names.join(' ')).trim(); },
      contains: (name) => this._class.split(/\s+/).includes(name),
    };
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node instanceof Fragment) this.append(...node.children);
      else { node.parent = this; this.children.push(node); }
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  setAttribute(key, value) { this.attrs[key] = value; }
  getAttribute(key) { return this.attrs[key]; }

  querySelector(selector) {
    for (const child of this.children) {
      if (child.tag === selector) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  closest(selector) {
    const wanted = selector.replace('.', '');
    let node = this;
    while (node) {
      if (node._class && node._class.split(/\s+/).includes(wanted)) return node;
      node = node.parent;
    }
    return null;
  }

  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type, event) { for (const fn of this.listeners[type] || []) fn(event); }

  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
}

class Fragment extends Element {
  constructor() { super('#fragment'); }
}

/**
 * Evaluate the real puzzles.js + main.js against a fresh fake document and
 * return handles for driving the resulting board.
 *
 * @param {object} [options]
 * @param {object} [options.puzzle]  substitute a synthetic board, for sizes the
 *                                   shipped puzzle set does not cover
 * @param {string} [options.search]  query string, e.g. '?puzzle=dev-9x9'
 */
function loadApp({ puzzle, search = '' } = {}) {
  const board = new Element('div');
  board.className = 'board';
  const status = new Element('p');
  const byId = { board, status };

  global.document = {
    getElementById: (id) => byId[id],
    createElement: (tag) => new Element(tag),
    createElementNS: (_ns, tag) => new Element(tag),
    createDocumentFragment: () => new Fragment(),
    elementFromPoint: (x, y) => {
      const row = Math.floor(y / CELL);
      const col = Math.floor(x / CELL);
      return board.children.find(
        (c) => Number(c.dataset.row) === row && Number(c.dataset.col) === col
      ) || null;
    },
  };

  global.location = { search };

  const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

  // Load exactly the scripts index.html loads, in the order it loads them,
  // into one shared scope — which is what classic scripts get in a browser.
  //
  // Deriving the list from the page rather than hardcoding it here is
  // deliberate, and not hypothetical caution: a <script> tag went missing once
  // and every test still passed, because the harness was loading a file the
  // page no longer did. A hardcoded list tests a page that does not exist.
  const scripts = [...read('index.html').matchAll(/<script src="([^"]+)"><\/script>/g)]
    .map((m) => m[1]);
  if (!scripts.length) throw new Error('no <script src> tags found in index.html');

  const sources = scripts.map((src) =>
    src === 'puzzles.js' && puzzle ? `const PUZZLES = ${JSON.stringify([puzzle])};` : read(src)
  );

  // Hand the rule functions back out so tests can exercise them directly,
  // without a board in the way.
  const exposed = 'return { EMPTY, MARK, CROWN, cellKey, crownPositions, findViolations, isSolved };';
  const rules = new Function(sources.join('\n') + '\n' + exposed)();

  const cellAt = (row, col) =>
    board.children.find((c) => Number(c.dataset.row) === row && Number(c.dataset.col) === col);
  const stateOf = (row, col) => cellAt(row, col).dataset.state;
  const point = (row, col) => ({ x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 });

  let nextPointerId = 1;

  const send = (type, row, col, id) => {
    const p = point(row, col);
    board.dispatch(type, {
      pointerId: id,
      clientX: p.x,
      clientY: p.y,
      target: type === 'pointerdown' ? cellAt(row, col) : board,
    });
  };

  const api = {
    board,
    status,
    rules,
    cellAt,
    stateOf,
    /** True when the cell holds a crown that is actually clashing. */
    violatingAt: (row, col) => cellAt(row, col).dataset.violation === 'cell',
    /** Clashing crowns, as sorted "row,col" keys, for stable comparison. */
    violations: () =>
      board.children
        .filter((c) => c.dataset.violation === 'cell')
        .map((c) => `${c.dataset.row},${c.dataset.col}`)
        .sort(),
    /** Cells tinted as part of a broken row/column/region, excluding the crowns. */
    scope: () =>
      board.children
        .filter((c) => c.dataset.violation === 'scope')
        .map((c) => `${c.dataset.row},${c.dataset.col}`)
        .sort(),
    /** Every cell carrying any violation styling. */
    highlighted: () =>
      board.children
        .filter((c) => c.dataset.violation)
        .map((c) => `${c.dataset.row},${c.dataset.col}`)
        .sort(),
    solved: () => board.dataset.solved === 'true',
    size: board.children.length ? Math.max(...board.children.map((c) => Number(c.dataset.row))) + 1 : 0,

    /** Start a new gesture and return its pointer id. */
    down: (row, col, id = nextPointerId++) => { send('pointerdown', row, col, id); return id; },
    move: (row, col, id) => send('pointermove', row, col, id),
    up: (row, col, id) => send('pointerup', row, col, id),
    cancel: (id) => board.dispatch('pointercancel', { pointerId: id }),

    tap(row, col) {
      const id = api.down(row, col);
      api.up(row, col, id);
    },

    /** Tap until the cell holds a crown, whatever it held before. */
    placeCrown(row, col) {
      let guard = 0;
      while (api.stateOf(row, col) !== 'crown') {
        api.tap(row, col);
        if (++guard > 4) throw new Error(`cell ${row},${col} will not accept a crown`);
      }
    },

    /** Place crowns at solution[row] = col, as a player finishing the puzzle. */
    placeCrowns(columnPerRow) {
      columnPerRow.forEach((col, row) => api.placeCrown(row, col));
    },

    /** cells: [[row, col], ...] — press on the first, drag through the rest. */
    drag(cells) {
      const id = api.down(...cells[0]);
      for (const cell of cells.slice(1)) api.move(...cell, id);
      api.up(...cells[cells.length - 1], id);
    },

    /** Tap every non-empty cell back round to empty. */
    reset() {
      for (const cell of board.children) {
        const row = Number(cell.dataset.row);
        const col = Number(cell.dataset.col);
        while (api.stateOf(row, col) !== 'empty') api.tap(row, col);
      }
    },
  };

  return api;
}

module.exports = { loadApp, CELL, ROOT };
