// Calculators in notes (docs/api/notes.md §3h): formulas over a calculator's
// inputs and earlier results, "water * per_litre". Parsed here into a tree
// and worked out by this code, never eval: a formula is text someone typed.
// Numbers, keys (letters, digits, _), + − * / % (remainder) ^ (power),
// parentheses, and round(x, decimals?), floor, ceil, abs, sqrt, min, max.
// Keys match ignoring case, as the API keeps them unique ignoring case.
import type { NoteCalculatorBlock } from '../api/types';

export type CalcNode =
  | { type: 'number'; value: number }
  | { type: 'ref'; key: string }
  | { type: 'unary'; op: '-'; arg: CalcNode }
  | { type: 'binary'; op: '+' | '-' | '*' | '/' | '%' | '^'; left: CalcNode; right: CalcNode }
  | { type: 'call'; fn: CalcFunction; args: CalcNode[] };

const FUNCTIONS = {
  round: { min: 1, max: 2, run: (x: number, d = 0) => Math.round(x * 10 ** d) / 10 ** d },
  floor: { min: 1, max: 1, run: Math.floor },
  ceil: { min: 1, max: 1, run: Math.ceil },
  abs: { min: 1, max: 1, run: Math.abs },
  sqrt: { min: 1, max: 1, run: Math.sqrt },
  min: { min: 1, max: 20, run: Math.min },
  max: { min: 1, max: 20, run: Math.max },
} as const satisfies Record<string, { min: number; max: number; run: (...args: number[]) => number }>;
export type CalcFunction = keyof typeof FUNCTIONS;
export const CALC_FUNCTIONS = Object.keys(FUNCTIONS) as CalcFunction[];
const isFunction = (name: string): name is CalcFunction => name in FUNCTIONS;

export class CalcError extends Error {}

type Token = { kind: 'number'; value: number } | { kind: 'name'; name: string } | { kind: 'op'; op: string };
const OPS: Record<string, string> = { '+': '+', '-': '-', '−': '-', '*': '*', '×': '*', '/': '/', '÷': '/', '%': '%', '^': '^', '(': '(', ')': ')', ',': ',' };

function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < formula.length) {
    const c = formula[i]!;
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(\d+(\.\d+)?|\.\d+)/.exec(formula.slice(i));
      if (!m) throw new CalcError(`“${c}” isn't a number`);
      tokens.push({ kind: 'number', value: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(formula.slice(i))![0];
      tokens.push({ kind: 'name', name });
      i += name.length;
    } else if (OPS[c]) {
      tokens.push({ kind: 'op', op: OPS[c]! });
      i++;
    } else {
      throw new CalcError(`“${c}” can't be used in a formula`);
    }
  }
  return tokens;
}

// expr := term (('+'|'-') term)* ; term := unary (('*'|'/'|'%') unary)* ;
// unary := '-' unary | power ; power := atom ('^' unary)? (right to left: 2^3^2 = 2^9)
function parse(tokens: Token[]): CalcNode {
  let pos = 0;
  const peekOp = () => {
    const t = tokens[pos];
    return t?.kind === 'op' ? t.op : null;
  };
  const expect = (op: string, what: string) => {
    if (peekOp() !== op) throw new CalcError(`Missing ${what}`);
    pos++;
  };
  function expr(): CalcNode {
    let node = term();
    for (let op = peekOp(); op === '+' || op === '-'; op = peekOp()) {
      pos++;
      node = { type: 'binary', op, left: node, right: term() };
    }
    return node;
  }
  function term(): CalcNode {
    let node = unary();
    for (let op = peekOp(); op === '*' || op === '/' || op === '%'; op = peekOp()) {
      pos++;
      node = { type: 'binary', op, left: node, right: unary() };
    }
    return node;
  }
  function unary(): CalcNode {
    if (peekOp() === '-') {
      pos++;
      return { type: 'unary', op: '-', arg: unary() };
    }
    if (peekOp() === '+') {
      pos++;
      return unary();
    }
    const base = atom();
    if (peekOp() !== '^') return base;
    pos++;
    return { type: 'binary', op: '^', left: base, right: unary() };
  }
  function atom(): CalcNode {
    const t = tokens[pos];
    if (!t) throw new CalcError('The formula ends too soon');
    pos++;
    if (t.kind === 'number') return { type: 'number', value: t.value };
    if (t.kind === 'name') {
      if (peekOp() !== '(') return { type: 'ref', key: t.name };
      const fn = t.name.toLowerCase();
      if (!isFunction(fn)) throw new CalcError(`There's no function called ${t.name} (try ${CALC_FUNCTIONS.join(', ')})`);
      pos++;
      const args: CalcNode[] = [];
      if (peekOp() !== ')') {
        args.push(expr());
        while (peekOp() === ',') {
          pos++;
          args.push(expr());
        }
      }
      expect(')', `“)” after ${fn}(…`);
      const { min, max } = FUNCTIONS[fn];
      if (args.length < min || args.length > max) {
        throw new CalcError(`${fn} takes ${min === max ? min : `${min} to ${max}`} value${max === 1 ? '' : 's'}`);
      }
      return { type: 'call', fn, args };
    }
    if (t.op === '(') {
      const inner = expr();
      expect(')', '“)”');
      return inner;
    }
    throw new CalcError(t.op === ')' ? 'A “)” without its “(”' : `“${t.op}” needs a number before it`);
  }
  if (!tokens.length) throw new CalcError('Enter a formula');
  const node = expr();
  if (pos < tokens.length) {
    const t = tokens[pos]!;
    throw new CalcError(t.kind === 'op' && t.op === ')' ? 'A “)” without its “(”' : `Missing an operator before “${t.kind === 'number' ? t.value : t.kind === 'name' ? t.name : t.op}”`);
  }
  return node;
}

export type Compiled = { ok: true; node: CalcNode; refs: string[] } | { ok: false; error: string };
export function compile(formula: string): Compiled {
  try {
    const node = parse(tokenize(formula));
    const refs = new Set<string>();
    const walk = (n: CalcNode): void => {
      if (n.type === 'ref') refs.add(n.key);
      else if (n.type === 'unary') walk(n.arg);
      else if (n.type === 'binary') (walk(n.left), walk(n.right));
      else if (n.type === 'call') n.args.forEach(walk);
    };
    walk(node);
    return { ok: true, node, refs: [...refs] };
  } catch (err) {
    if (err instanceof CalcError) return { ok: false, error: err.message };
    throw err;
  }
}

// vars: by lower-case key.
export function evaluate(node: CalcNode, vars: ReadonlyMap<string, number>): number {
  switch (node.type) {
    case 'number':
      return node.value;
    case 'ref': {
      const v = vars.get(node.key.toLowerCase());
      if (v === undefined) throw new CalcError(`Nothing is called ${node.key}`);
      return v;
    }
    case 'unary':
      return -evaluate(node.arg, vars);
    case 'call':
      return (FUNCTIONS[node.fn].run as (...args: number[]) => number)(...node.args.map((a) => evaluate(a, vars)));
    case 'binary': {
      const [a, b] = [evaluate(node.left, vars), evaluate(node.right, vars)];
      if ((node.op === '/' || node.op === '%') && b === 0) throw new CalcError("Can't divide by zero");
      return node.op === '+' ? a + b : node.op === '-' ? a - b : node.op === '*' ? a * b : node.op === '/' ? a / b : node.op === '%' ? a % b : a ** b;
    }
  }
}

export type CalcOutcome = { key: string; value: number; error: null } | { key: string; value: null; error: string };

// Each result in order, from the inputs (values by key) and the results above it.
export function runCalculator(block: Pick<NoteCalculatorBlock, 'inputs' | 'results'>, values: Readonly<Record<string, number | null>>): CalcOutcome[] {
  const vars = new Map<string, number>();
  const missing = new Set<string>();
  for (const input of block.inputs) {
    const v = values[input.key];
    if (v === null || v === undefined) missing.add(input.key.toLowerCase());
    else vars.set(input.key.toLowerCase(), v);
  }
  const later = new Set(block.results.map((r) => r.key.toLowerCase()));
  const failed = new Set<string>();
  return block.results.map((r): CalcOutcome => {
    const k = r.key.toLowerCase();
    later.delete(k);
    const compiled = compile(r.formula);
    const fail = (error: string): CalcOutcome => (failed.add(k), { key: r.key, value: null, error });
    if (!compiled.ok) return fail(compiled.error);
    for (const ref of compiled.refs) {
      const lk = ref.toLowerCase();
      if (lk === k) return fail(`It can't use itself (${ref})`);
      if (later.has(lk)) return fail(`It uses ${ref}, which comes after it: move it up`);
      if (missing.has(lk)) return fail(`Enter ${block.inputs.find((i) => i.key.toLowerCase() === lk)?.label ?? ref}`);
      if (failed.has(lk)) return fail(`${block.results.find((x) => x.key.toLowerCase() === lk)?.label ?? ref} can't be worked out`);
      if (!vars.has(lk)) return fail(`Nothing is called ${ref}`);
    }
    try {
      const value = evaluate(compiled.node, vars);
      if (!Number.isFinite(value)) return fail('Too big to work out');
      vars.set(k, value);
      return { key: r.key, value, error: null };
    } catch (err) {
      if (err instanceof CalcError) return fail(err.message);
      throw err;
    }
  });
}

// "1,8" or "-2.5" -> a number; null when it isn't one.
export function parseCalcNumber(text: string): number | null {
  const t = text.trim().replace(',', '.');
  return /^-?(\d+(\.\d+)?|\.\d+)$/.test(t) ? Number(t) : null;
}

// To the result's decimals, without trailing zeros: 36, 7.1, 0.25.
export function formatCalc(value: number, decimals: number): string {
  const fixed = Number(value.toFixed(decimals));
  return (Object.is(fixed, -0) ? 0 : fixed).toLocaleString(undefined, { maximumFractionDigits: decimals, useGrouping: false });
}
