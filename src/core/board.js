import { gf4Add, gf4Pow, G0 } from './gf4.js';

export class Board {
  constructor(rows, cols, analysis = false) {
    this.rows = rows;
    this.cols = cols;
    this.analysis = analysis;
    this.singleToggle = false;
    this.cells = Array.from({ length: rows }, () => new Array(cols).fill(false));
    this.curRow = 0;
    this.curCol = 0;
    this.history = [];
    this.moves = 0;
  }

  clear() {
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        this.cells[r][c] = false;
  }

  // 解析モードの外周セルかどうか
  isOuterCell(r, c) {
    if (!this.analysis) return false;
    return r === 0 || r === this.rows - 1 || c === 0 || c === this.cols - 1;
  }

  // 解析モードの内部セル範囲 [rMin, rMax, cMin, cMax]
  innerBounds() {
    return [1, this.rows - 2, 1, this.cols - 2];
  }

  // 1マス反転
  doSingleToggle(r, c) {
    this.cells[r][c] = !this.cells[r][c];
  }

  // 押したセル + 8近傍を反転
  doToggle(r, c) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols)
          this.cells[nr][nc] = !this.cells[nr][nc];
      }
    }
  }

  pushHistory() {
    this.history.push(this.cells.map(row => [...row]));
  }

  undo() {
    if (this.history.length === 0) return;
    this.cells = this.history.pop();
    if (this.moves > 0) this.moves--;
  }

  isSolved() {
    return this.cells.every(row => row.every(v => !v));
  }

  moveCursor(dr, dc) {
    this.curRow = Math.max(0, Math.min(this.rows - 1, this.curRow + dr));
    this.curCol = Math.max(0, Math.min(this.cols - 1, this.curCol + dc));
  }

  // GF(4) 重み付き行和
  gf4RowSum(r) {
    let sum = G0;
    for (let c = 0; c < this.cols; c++)
      if (this.cells[r][c])
        sum = gf4Add(sum, gf4Pow(r + c));
    return sum;
  }

  // GF(4) 重み付き列和
  gf4ColSum(c) {
    let sum = G0;
    for (let r = 0; r < this.rows; r++)
      if (this.cells[r][c])
        sum = gf4Add(sum, gf4Pow(r + c));
    return sum;
  }

  // 必ず解けるスクランブル（通常モード用）
  scrambleSolvable() {
    this.clear();
    const n = this.rows * this.cols * 3;
    for (let i = 0; i < n; i++)
      this.doToggle(
        Math.floor(Math.random() * this.rows),
        Math.floor(Math.random() * this.cols),
      );
    if (this.isSolved())
      this.cells[Math.floor(this.rows / 2)][Math.floor(this.cols / 2)] = true;
    this.history = [];
    this.moves = 0;
    this.curRow = 0;
    this.curCol = 0;
  }

  // 内部セル操作のみで解けるスクランブル（解析モード用）
  scrambleSolvableInner() {
    this.clear();
    const [rMin, rMax, cMin, cMax] = this.innerBounds();
    const innerR = rMax - rMin + 1;
    const innerC = cMax - cMin + 1;
    if (innerR > 0 && innerC > 0) {
      const n = innerR * innerC * 3;
      for (let i = 0; i < n; i++) {
        const r = rMin + Math.floor(Math.random() * innerR);
        const c = cMin + Math.floor(Math.random() * innerC);
        this.doToggle(r, c);
      }
    }
    if (this.isSolved())
      this.cells[Math.floor((rMin + rMax) / 2)][Math.floor((cMin + cMax) / 2)] = true;
    this.history = [];
    this.moves = 0;
    this.curRow = this.analysis ? 1 : 0;
    this.curCol = this.analysis ? 1 : 0;
  }

  // ランダム任意配置（解けるとは限らない）
  scrambleArbitrary() {
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        this.cells[r][c] = Math.random() < 0.5;
    if (this.isSolved())
      this.cells[0][0] = true;
    this.history = [];
    this.moves = 0;
    if (this.analysis) {
      const [rMin, , cMin] = this.innerBounds();
      this.curRow = rMin;
      this.curCol = cMin;
    }
  }
}
