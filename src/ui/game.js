import { Board }              from '../core/board.js';
import { fillOuterToZeroGF4 } from '../core/solver.js';

// Game — アプリ全体の状態管理とゲームロジック
//
// このクラスが renderer.js / input.js の橋渡しをする。
// renderer.render(game) に渡すとそのまま描画できる形になっている。

export class Game {
  constructor() {
    // モード
    this.mode = 'menu';   // 'menu' | 'game'

    // メニュー状態
    this.mStep  = 'rows'; // 'rows' | 'cols' | 'mode'
    this.mRows  = '';
    this.mCols  = '';
    this.errMsg = '';

    // ゲーム状態（ゲーム開始後に設定）
    this.board        = null;
    this.showAnalysis = false; // 通常ゲームモードの GF(4) オーバーレイ
    this.fromGame     = false; // 解析モードにゲームモードから遷移した場合 true
  }

  // ── メニュー操作 ──────────────────────────────────────────────

  // Enter: 現在のステップの入力を確定し次へ進む
  menuConfirm() {
    if (this.mStep === 'rows') {
      const n = parseInt(this.mRows, 10);
      if (isNaN(n) || n < 1 || n > 20) {
        this.errMsg = '1〜20 の整数を入力してください';
        this.mRows  = '';
      } else {
        this.errMsg = '';
        this.mStep  = 'cols';
      }

    } else if (this.mStep === 'cols') {
      const n = parseInt(this.mCols, 10);
      if (isNaN(n) || n < 1 || n > 20) {
        this.errMsg = '1〜20 の整数を入力してください';
        this.mCols  = '';
      } else {
        this.errMsg = '';
        this.mStep  = 'mode';
      }
    }
    // StepMode では Enter は何もしない（1/2 キーで選択）
  }

  // Backspace: 1文字削除、または前のステップへ戻る
  menuDelete() {
    if (this.mStep === 'rows') {
      if (this.mRows.length > 0) this.mRows = this.mRows.slice(0, -1);

    } else if (this.mStep === 'cols') {
      if (this.mCols.length > 0) {
        this.mCols = this.mCols.slice(0, -1);
      } else {
        this.mStep  = 'rows';
        this.errMsg = '';
      }

    } else if (this.mStep === 'mode') {
      this.mStep  = 'cols';
      this.errMsg = '';
    }
  }

  // 数字キー: 現在のステップの入力フィールドに追加（2桁まで）
  menuType(digit) {
    if (this.mStep === 'rows' && this.mRows.length < 2) {
      this.mRows += digit;
    } else if (this.mStep === 'cols' && this.mCols.length < 2) {
      this.mCols += digit;
    }
  }

  // 1 or 2: ゲームを開始する
  // analysis=false → 通常ゲームモード (m×n)
  // analysis=true  → 解析モード ((m+2)×(n+2))
  selectMode(analysis) {
    const m = parseInt(this.mRows, 10);
    const n = parseInt(this.mCols, 10);

    if (analysis) {
      this.board = new Board(m + 2, n + 2, true);
      this.board.scrambleSolvableInner();
      fillOuterToZeroGF4(this.board);
    } else {
      this.board = new Board(m, n, false);
      this.board.scrambleSolvable();
    }

    this.showAnalysis = false;
    this.fromGame     = false;
    this.mode         = 'game';
  }

  // ── ゲーム操作 ────────────────────────────────────────────────

  // Space/Enter: カーソル位置を反転する
  press() {
    const { board } = this;
    if (!board.isSolved() || board.analysis) {
      board.pushHistory();
      if (board.analysis && board.singleToggle) {
        board.doSingleToggle(board.curRow, board.curCol);
      } else {
        board.doToggle(board.curRow, board.curCol);
      }
      board.moves++;
    }
  }

  // R: 通常モードのみ、解ける配置で再スタート
  restart() {
    if (!this.board.analysis) {
      this.board.scrambleSolvable();
    }
  }

  // G: 通常ゲームモードの GF(4) オーバーレイ表示切替
  toggleGF4() {
    if (!this.board.analysis) {
      this.showAnalysis = !this.showAnalysis;
    }
  }

  // S: 解ける配置生成（モードを自動判別）
  // 通常モード → scrambleSolvable
  // 解析モード → scrambleSolvableInner（外周はそのまま）
  scramble() {
    if (this.board.analysis) {
      this.board.scrambleSolvableInner();
    } else {
      this.board.scrambleSolvable();
    }
  }

  // A: 任意配置生成（解析モードのみ）
  arbitrary() {
    if (this.board.analysis) {
      this.board.scrambleArbitrary();
    }
  }

  // T: 反転モード切替（解析モードのみ）
  toggleFlipMode() {
    if (this.board.analysis) {
      this.board.singleToggle = !this.board.singleToggle;
    }
  }

  // E: 全消灯（解析モードのみ）、カーソルを内部左上へリセット
  clearAnalysis() {
    if (this.board.analysis) {
      this.board.clear();
      this.board.history = [];
      this.board.moves   = 0;
      this.board.curRow  = 1;
      this.board.curCol  = 1;
    }
  }

  // Q: メニューへ戻る（モード選択ステップへ、mRows/mCols は保持）
  returnToMenu() {
    this.mode         = 'menu';
    this.mStep        = 'mode';
    this.errMsg       = '';
    this.showAnalysis = false;
  }

  // \（または Y×5 コンボ）: ゲームモード → 解析モードへ遷移
  // 現在の m×n 盤面を (m+2)×(n+2) へ拡張し、
  // 外周を GF(4) 行/列和がすべて 0 になるように埋める
  enterAnalysis() {
    const old = this.board;
    const m   = old.rows;
    const n   = old.cols;

    const nb = new Board(m + 2, n + 2, true);

    // 内部セルに現在の盤面をコピー
    for (let r = 0; r < m; r++)
      for (let c = 0; c < n; c++)
        nb.cells[r + 1][c + 1] = old.cells[r][c];

    fillOuterToZeroGF4(nb);

    nb.history      = [];
    nb.moves        = 0;
    nb.curRow       = 1;
    nb.curCol       = 1;
    nb.singleToggle = false;

    this.board        = nb;
    this.fromGame     = true;
    this.showAnalysis = false;
  }

  // \（fromGame 時のみ）: 解析モード → 元のゲームモードへ復帰
  // 内部セル (1..rows-2, 1..cols-2) を取り出して m×n 盤面に戻す
  exitAnalysis() {
    const old = this.board;
    const m   = old.rows - 2;
    const n   = old.cols - 2;

    const nb = new Board(m, n, false);

    for (let r = 0; r < m; r++)
      for (let c = 0; c < n; c++)
        nb.cells[r][c] = old.cells[r + 1][c + 1];

    nb.history = [];
    nb.moves   = 0;
    nb.curRow  = 0;
    nb.curCol  = 0;

    this.board        = nb;
    this.fromGame     = false;
    this.showAnalysis = false;
  }
}
