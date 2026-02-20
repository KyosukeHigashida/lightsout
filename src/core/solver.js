import { gf4Pow } from './gf4.js';

// board の外周セルを 0/1 で設定し、全行・全列の GF(4) 重み和が 0 になるようにする。
export function fillOuterToZeroGF4(board) {
  if (!board.analysis || board.rows < 3 || board.cols < 3) return;

  const { rows, cols } = board;

  // 外周セルの変数リストとインデックスマップ
  const vars = []; // [[r, c], ...]
  const idx = new Map(); // r*cols+c -> 変数インデックス

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) {
        idx.set(r * cols + c, vars.length);
        vars.push([r, c]);
      }
    }
  }

  const nVars = vars.length;
  if (nVars === 0) return;

  // 外周を一旦 false にして内部セルだけの GF(4) 和を計算
  const snapshot = vars.map(([r, c]) => board.cells[r][c]);
  for (const [r, c] of vars) board.cells[r][c] = false;

  const internalRow = Array.from({ length: rows }, (_, r) => board.gf4RowSum(r));
  const internalCol = Array.from({ length: cols }, (_, c) => board.gf4ColSum(c));

  const eqs = buildGF4ZeroSystem(rows, cols, vars, idx, internalRow, internalCol);
  const sol = solveGF2(eqs, nVars);

  if (sol === null) {
    // 通常は起きない: 外周を元に戻す
    vars.forEach(([r, c], i) => { board.cells[r][c] = snapshot[i]; });
    return;
  }

  vars.forEach(([r, c], i) => { board.cells[r][c] = sol[i]; });
}

// GF(4) の行/列和ゼロ条件を GF(2) の連立一次方程式に変換する。
// 各 GF(4) 方程式（2ビット）を 2 本の GF(2) 方程式に分解する。
// ビットセットには BigInt を使用（nVars ≤ ~88 なので十分）。
function buildGF4ZeroSystem(rows, cols, vars, idx, internalRow, internalCol) {
  const eqs = [];

  // 行制約
  for (let r = 0; r < rows; r++) {
    for (let bit = 0; bit < 2; bit++) {
      let bs = 0n;
      for (let c = 0; c < cols; c++) {
        if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) {
          const i = idx.get(r * cols + c);
          if (i === undefined) continue;
          const coef = gf4Pow(r + c);
          if (((coef >> bit) & 1) === 1) bs |= (1n << BigInt(i));
        }
      }
      eqs.push({ bits: bs, rhs: (internalRow[r] >> bit) & 1 });
    }
  }

  // 列制約
  for (let c = 0; c < cols; c++) {
    for (let bit = 0; bit < 2; bit++) {
      let bs = 0n;
      for (let r = 0; r < rows; r++) {
        if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) {
          const i = idx.get(r * cols + c);
          if (i === undefined) continue;
          const coef = gf4Pow(r + c);
          if (((coef >> bit) & 1) === 1) bs |= (1n << BigInt(i));
        }
      }
      eqs.push({ bits: bs, rhs: (internalCol[c] >> bit) & 1 });
    }
  }

  return eqs;
}

// GF(2) 連立一次方程式をガウス消去（RREF）で解く。
// 解が存在すれば bool[] を返し、矛盾なら null を返す。
// 自由変数はデフォルト 0（false）とする。
function solveGF2(eqs, nVars) {
  const A = eqs.map(eq => ({ bits: eq.bits, rhs: eq.rhs }));

  let pivRow = 0;
  const pivCols = [];

  for (let col = 0; col < nVars && pivRow < A.length; col++) {
    // pivot 探索
    let p = -1;
    for (let r = pivRow; r < A.length; r++) {
      if (((A[r].bits >> BigInt(col)) & 1n) === 1n) { p = r; break; }
    }
    if (p === -1) continue;

    [A[pivRow], A[p]] = [A[p], A[pivRow]];
    pivCols.push(col);

    // 全行消去（上下両方向 → RREF）
    for (let r = 0; r < A.length; r++) {
      if (r === pivRow) continue;
      if (((A[r].bits >> BigInt(col)) & 1n) === 1n) {
        A[r].bits ^= A[pivRow].bits;
        A[r].rhs  ^= A[pivRow].rhs;
      }
    }

    pivRow++;
  }

  // 矛盾チェック: 0·x = 1 の行があれば解なし
  for (const eq of A) {
    if (eq.bits === 0n && eq.rhs === 1) return null;
  }

  // 後退代入
  const x = new Array(nVars).fill(false);
  let xBits = 0n;

  for (let i = pivCols.length - 1; i >= 0; i--) {
    const col = pivCols[i];
    const row = i;

    // pivot ビットを落として残り変数との内積を計算
    const bsNoPivot = A[row].bits & ~(1n << BigInt(col));
    const s = bigintParity(bsNoPivot & xBits);

    if ((A[row].rhs ^ s) === 1) {
      x[col] = true;
      xBits |= (1n << BigInt(col));
    }
  }

  return x;
}

// popcount(n) mod 2（BigInt 用）
function bigintParity(n) {
  let p = 0;
  while (n > 0n) {
    p ^= Number(n & 1n);
    n >>= 1n;
  }
  return p;
}
