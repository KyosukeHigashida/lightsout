// input.js — キーボード入力ハンドラ
//
// InputHandler が呼び出す game のインターフェース:
//   game.mode           : 'menu' | 'game'
//   game.mStep          : 'rows' | 'cols' | 'mode'
//   game.board.analysis : bool
//   game.fromGame       : bool
//
//   // メニュー操作
//   game.menuConfirm()        Enter — 入力確定・次のステップへ
//   game.menuDelete()         Backspace — 1文字削除 or 前のステップへ
//   game.menuType(digit)      数字キー — 文字を追加
//   game.selectMode(analysis) 1/2 — ゲーム開始
//
//   // ゲーム操作
//   game.board.moveCursor(dr, dc)
//   game.press()              Space/Enter — 反転実行
//   game.board.undo()         U
//   game.restart()            R — 通常モードのみ、解ける配置で再スタート
//   game.toggleGF4()          G — 通常モードの GF(4) オーバーレイ切替
//   game.scramble()           S — 解ける配置生成（モードを自動判別）
//   game.arbitrary()          A — 任意配置生成（解析モードのみ）
//   game.toggleFlipMode()     T — 反転モード切替（解析モードのみ）
//   game.clearAnalysis()      E — 全消灯（解析モードのみ）
//   game.returnToMenu()       Q — メニューへ戻る
//   game.enterAnalysis()      \ or Y×5 — ゲーム→解析モード遷移
//   game.exitAnalysis()       \ — 解析→ゲームモード復帰（fromGame 時のみ）

// hjkl / 矢印キー → [dr, dc] のマッピング
const MOVE_KEYS = {
  ArrowUp:    [-1,  0],
  ArrowDown:  [ 1,  0],
  ArrowLeft:  [ 0, -1],
  ArrowRight: [ 0,  1],
  k:          [-1,  0],
  j:          [ 1,  0],
  h:          [ 0, -1],
  l:          [ 0,  1],
};

export class InputHandler {
  constructor(game, renderer) {
    this.game     = game;
    this.renderer = renderer;

    // Y キー連打コンボ（仕様の隠しコマンド: 1秒以内に5回）
    this._yTimes = [];

    this._onKey   = this._onKey.bind(this);
    this._onTouch = this._onTouch.bind(this);
    this._onClick = this._onClick.bind(this);

    this._appEl = document.getElementById('app');
  }

  attach() {
    document.addEventListener('keydown', this._onKey);
    this._appEl.addEventListener('touchstart', this._onTouch, { passive: false });
    this._appEl.addEventListener('click', this._onClick);
  }

  detach() {
    document.removeEventListener('keydown', this._onKey);
    this._appEl.removeEventListener('touchstart', this._onTouch);
    this._appEl.removeEventListener('click', this._onClick);
  }

  _onKey(e) {
    const handled = this.game.mode === 'menu'
      ? this._handleMenu(e)
      : this._handleGame(e);

    if (handled) {
      e.preventDefault();
      this.renderer.render(this.game);
    }
  }

  // ── メニュー ────────────────────────────────────────────────

  _handleMenu(e) {
    const { key } = e;
    const { game } = this;

    // Q / Escape: ブラウザではタブを閉じるしかないため無視
    if (key === 'q' || key === 'Q' || key === 'Escape') return false;

    if (key === 'Enter') {
      game.menuConfirm();
      return true;
    }

    if (key === 'Backspace') {
      game.menuDelete();
      return true;
    }

    // モード選択ステップ: 1 / 2
    if (game.mStep === 'mode') {
      if (key === '1') { game.selectMode(false); return true; }
      if (key === '2') { game.selectMode(true);  return true; }
      return false;
    }

    // 行数・列数入力ステップ: 数字のみ受け付け
    if (/^[0-9]$/.test(key)) {
      game.menuType(key);
      return true;
    }

    return false;
  }

  // ── ゲーム ──────────────────────────────────────────────────

  _handleGame(e) {
    const { key } = e;
    const { game } = this;
    const { board } = game;

    // カーソル移動
    if (MOVE_KEYS[key]) {
      board.moveCursor(...MOVE_KEYS[key]);
      return true;
    }

    switch (key) {
      // メニューへ戻る
      case 'q': case 'Q':
        game.returnToMenu();
        return true;

      // 反転
      case ' ': case 'Enter':
        game.press();
        return true;

      // アンドゥ
      case 'u': case 'U':
        board.undo();
        return true;

      // 解ける配置生成（S キー: モード自動判別）
      case 's': case 'S':
        game.scramble();
        return true;

      // 任意配置生成（解析モードのみ）
      case 'a': case 'A':
        if (board.analysis) game.arbitrary();
        return true;

      // 反転モード切替（解析モードのみ）
      case 't': case 'T':
        if (board.analysis) game.toggleFlipMode();
        return true;

      // 全消灯（解析モードのみ）
      case 'e': case 'E':
        if (board.analysis) game.clearAnalysis();
        return true;

      // リスタート（通常モードのみ）
      case 'r': case 'R':
        if (!board.analysis) game.restart();
        return true;

      // 隠しコマンド: ゲーム → 解析 / 解析 → ゲーム
      case '\\':
        if (!board.analysis) {
          game.enterAnalysis();
        } else if (game.fromGame) {
          game.exitAnalysis();
        }
        return true;

      // 仕様の隠しコマンド: 1秒以内に Y を5回連打 → 解析モードへ
      case 'y': case 'Y':
        if (!board.analysis && this._checkYCombo()) {
          game.enterAnalysis();
          return true;
        }
        return false;
    }

    return false;
  }

  // ── タッチ / クリック ────────────────────────────────────────

  _onTouch(e) {
    const canvas = e.target.closest('canvas.board');
    if (canvas && this.game.mode === 'game') {
      e.preventDefault();
      const touch = e.touches[0];
      this._handleCanvasTap(touch.clientX, touch.clientY, canvas);
    }
  }

  _onClick(e) {
    const canvas = e.target.closest('canvas.board');
    if (canvas && this.game.mode === 'game') {
      this._handleCanvasTap(e.clientX, e.clientY, canvas);
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (btn) {
      this._dispatchAction(btn.dataset.action);
    }
  }

  _handleCanvasTap(clientX, clientY, canvas) {
    const CELL = parseInt(canvas.dataset.cellSize, 10);
    const PAD  = parseInt(canvas.dataset.padSize,  10);
    if (!CELL || !PAD) return;

    const rect  = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / (window.devicePixelRatio || 1) / rect.width;
    const scaleY = canvas.height / (window.devicePixelRatio || 1) / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top)  * scaleY;

    const col = Math.floor((x - PAD) / (CELL + PAD));
    const row = Math.floor((y - PAD) / (CELL + PAD));

    const { board } = this.game;
    if (row < 0 || row >= board.rows || col < 0 || col >= board.cols) return;

    board.curRow = row;
    board.curCol = col;
    this.game.press();
    this.renderer.render(this.game);
  }

  _dispatchAction(action) {
    const { game, renderer } = this;
    const { board } = game;

    if (game.mode === 'menu') {
      const digitMatch = action.match(/^digit(\d)$/);
      if (digitMatch) {
        game.menuType(digitMatch[1]);
      } else if (action === 'confirm') {
        game.menuConfirm();
      } else if (action === 'delete') {
        game.menuDelete();
      } else if (action === 'mode1') {
        game.selectMode(false);
      } else if (action === 'mode2') {
        game.selectMode(true);
      }
    } else {
      switch (action) {
        case 'press':        game.press();            break;
        case 'undo':         board.undo();            break;
        case 'restart':      game.restart();          break;
        case 'scramble':     game.scramble();         break;
        case 'arbitrary':    game.arbitrary();        break;
        case 'toggleFlip':   game.toggleFlipMode();   break;
        case 'clear':        game.clearAnalysis();    break;
        case 'toggleGF4':    game.toggleGF4();        break;
        case 'quit':         game.returnToMenu();     break;
        case 'enterAnalysis': game.enterAnalysis();    break;
        case 'exitAnalysis': game.exitAnalysis();     break;
      }
    }

    renderer.render(game);
  }

  // Y コンボ判定: 1秒以内に5回 → true を返してカウンタをリセット
  _checkYCombo() {
    const now = Date.now();
    this._yTimes.push(now);
    this._yTimes = this._yTimes.filter(t => now - t <= 1000);
    if (this._yTimes.length >= 5) {
      this._yTimes = [];
      return true;
    }
    return false;
  }
}
