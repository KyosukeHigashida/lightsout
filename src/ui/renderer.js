// renderer.js — DOM 描画モジュール
//
// render(state) が受け取る state の形:
// {
//   mode:         'menu' | 'game',
//   mStep:        'rows' | 'cols' | 'mode',
//   mRows:        string,
//   mCols:        string,
//   errMsg:       string,
//   showAnalysis: bool,   // ゲームモード中の GF(4) オーバーレイ
//   fromGame:     bool,   // 解析モードへゲームモードから遷移した場合
//   board:        Board,  // board.analysis / singleToggle / moves / … を含む
// }

// GF(4) 元の表示シンボルと CSS クラス（インデックス = 値 0〜3）
const GF4_SYM   = [' 0 ', ' 1 ', ' ω ', 'ω²'];
const GF4_CLASS = ['gf4-zero', 'gf4-one', 'gf4-omega', 'gf4-omega2'];

// canvas 描画用 GF(4) 定数
const GF4_COLORS = ['#484848', '#0dd', '#cc0', '#d0d'];
const GF4_SYMS   = ['0', '1', 'ω', 'ω²'];

// HTML 特殊文字をエスケープ（ユーザ入力の安全な挿入用）
function h(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function gf4HTML(v) {
  return `<span class="gf4 ${GF4_CLASS[v]}">${GF4_SYM[v]}</span>`;
}

const GF4_LEGEND = [0, 1, 2, 3].map(gf4HTML).join(' ');

export class Renderer {
  constructor(rootEl) {
    this.root = rootEl;
  }

  render(state) {
    this.root.innerHTML = state.mode === 'game'
      ? this._gameHTML(state)
      : state.mode === 'title'
      ? this._titleHTML()
      : this._menuHTML(state);
    if (state.mode === 'game') {
      const canvas = this.root.querySelector('canvas.board');
      if (canvas) {
        const showGF4 = state.board.analysis || state.showAnalysis;
        this._drawBoard(canvas, state.board, showGF4);
      }
    }
  }

  // ── タイトル画面 ──────────────────────────────────────────────

  _titleHTML() {
    return `
      <div class="screen title">
        <h1 class="title">LIGHTS OUT</h1>
        <p class="title-start">タップまたは任意のキーでスタート<span class="cursor">█</span></p>
        <p class="rule">【ルール】パネルを押すとそのパネルと周囲8マスが反転。すべて消灯させればクリア！</p>
      </div>
    `;
  }

  // ── メニュー画面 ──────────────────────────────────────────────

  _menuHTML({ mStep, mRows, mCols, errMsg }) {
    let body = '';

    if (mStep === 'rows') {
      body = `
        <p class="prompt">行数 m を入力してください (1〜20):</p>
        <p class="input-line">m (行数) &gt; <span class="input-val">${h(mRows)}</span><span class="cursor">█</span></p>
        <div class="touch-pad">
          <div class="numpad-grid">
            <button class="numpad-btn" data-action="digit7">7</button>
            <button class="numpad-btn" data-action="digit8">8</button>
            <button class="numpad-btn" data-action="digit9">9</button>
            <button class="numpad-btn" data-action="digit4">4</button>
            <button class="numpad-btn" data-action="digit5">5</button>
            <button class="numpad-btn" data-action="digit6">6</button>
            <button class="numpad-btn" data-action="digit1">1</button>
            <button class="numpad-btn" data-action="digit2">2</button>
            <button class="numpad-btn" data-action="digit3">3</button>
            <span></span>
            <button class="numpad-btn" data-action="digit0">0</button>
            <button class="numpad-btn" data-action="delete">⌫</button>
          </div>
          <button class="touch-btn" data-action="confirm">決定 (Enter)</button>
        </div>
      `;

    } else if (mStep === 'cols') {
      body = `
        <p class="sub">m = ${h(mRows)}</p>
        <p class="prompt">列数 n を入力してください (1〜20):</p>
        <p class="input-line">n (列数) &gt; <span class="input-val">${h(mCols)}</span><span class="cursor">█</span></p>
        <div class="touch-pad">
          <div class="numpad-grid">
            <button class="numpad-btn" data-action="digit7">7</button>
            <button class="numpad-btn" data-action="digit8">8</button>
            <button class="numpad-btn" data-action="digit9">9</button>
            <button class="numpad-btn" data-action="digit4">4</button>
            <button class="numpad-btn" data-action="digit5">5</button>
            <button class="numpad-btn" data-action="digit6">6</button>
            <button class="numpad-btn" data-action="digit1">1</button>
            <button class="numpad-btn" data-action="digit2">2</button>
            <button class="numpad-btn" data-action="digit3">3</button>
            <span></span>
            <button class="numpad-btn" data-action="digit0">0</button>
            <button class="numpad-btn" data-action="delete">⌫</button>
          </div>
          <button class="touch-btn" data-action="confirm">決定 (Enter)</button>
        </div>
      `;

    } else {
      const m = parseInt(mRows, 10);
      const n = parseInt(mCols, 10);
      body = `
        <p class="sub">盤面サイズ: m=${m}, n=${n}</p>
        <p class="prompt">モードを選択してください:</p>
        <div class="mode-option">
          <p><span class="key">[1]</span> ゲームモード</p>
          <p class="mode-desc">
            盤面: ${m} 行 × ${n} 列<br>
            hjkl/←↓↑→ 移動　Space/Enter 反転　U 一手戻す　R やり直し 
          </p>
        </div>
        <div class="mode-option">
          <p><span class="key">[2]</span> 数理解析モード</p>
          <p class="mode-desc">
            盤面: ${m + 2} 行 × ${n + 2} 列（外周1マス含む）<br>
            外周セル <span class="cell outer">□</span> は青背景で表示<br>
            S 解ける配置　A 無作為な配置　hjkl/←↓↑→ 移動　Space/Enter 反転
          </p>
        </div>
        <p class="gf4-legend">F₄: ${GF4_LEGEND}</p>
        <div class="touch-pad">
          <button class="touch-btn" data-action="mode1">ゲームモード</button>
          <button class="touch-btn" data-action="mode2">数理解析モード</button>
          <button class="touch-btn touch-btn--back" data-action="delete">← 戻る</button>
        </div>
      `;
    }

    const helpText = mStep === 'mode'
      ? '[1/2] 選択 &nbsp; [BS] 戻る &nbsp; [Q] 終了'
      : '[Enter] 次へ &nbsp; [BS] 削除 &nbsp; [Q] 終了';

    return `
      <div class="screen menu">
        <h1 class="title">LIGHTS OUT</h1>
        ${body}
        ${errMsg ? `<p class="error">! ${h(errMsg)}</p>` : ''}
        <p class="help">${helpText}</p>
        <p class="rule">【ルール】パネルを押すとそのパネルと周囲8マスが反転。すべて消灯させればクリア！</p>
      </div>
    `;
  }

  // ── ゲーム・解析画面 ──────────────────────────────────────────

  _gameHTML({ board, showAnalysis, fromGame }) {
    const { analysis, singleToggle, moves } = board;
    const showGF4 = analysis || showAnalysis;
    const solved  = board.isSolved();

    return `
      <div class="screen game">
        ${this._headerHTML(board, showAnalysis)}
        <canvas class="board"></canvas>
        <div class="footer">
          ${this._footerHTML(board, showAnalysis, fromGame, solved)}
        </div>
      </div>
    `;
  }

  _headerHTML(board, showAnalysis) {
    const { analysis, moves, rows, cols } = board;
    let label = '';

    if (analysis) {
      const m = rows - 2, n = cols - 2;
      label = `<span class="mode-label analysis">LIGHTS OUT [ANALYSIS]</span>
               (${m}+2)×(${n}+2)=${rows}×${cols}　手数: ${moves}`;
    } else if (showAnalysis) {
      label = `<span class="mode-label">LIGHTS OUT</span>
               <span class="gf4-label">[GF₄]</span> ${rows}×${cols}　手数: ${moves}`;
    } else {
      label = `<span class="mode-label">LIGHTS OUT</span> ${rows}×${cols}　手数: ${moves}`;
    }

    const undoHint = board.history.length > 0 ? ' <span class="key">[U]</span>' : '';
    return `<p class="game-header">${label}${undoHint}</p>`;
  }

  // フッター
  _footerHTML(board, showAnalysis, fromGame, solved) {
    const { analysis, singleToggle, moves } = board;

    if (analysis) {
      const toggleLabel = singleToggle ? '1マス反転' : '3×3マス反転';
      return `
        <p class="keybinds">hjkl / ←↓↑→ 移動　Space/Enter 反転　U 一手戻す　Q メニュー</p>
        ${fromGame ? '<p class="keybinds"><span class="key">[Y]</span> ゲームモードへ戻る</p>' : ''}
        <p class="keybinds">
          <span class="key">S</span> 解ける配置生成（内部操作のみ）&nbsp;
          <span class="key">A</span> 無作為な配置生成 &nbsp;
          <span class="key">E</span> 全消灯
        </p>
        <p class="keybinds">
          <span class="key">T</span> 反転モード切替: <strong>${toggleLabel}</strong>
        </p>
        <p class="legend">
          <span class="cell outer">□</span> 外周 &nbsp;
          <span class="cell">□</span> 内部消灯 &nbsp;
          <span class="cell lit">■</span> 内部点灯
        </p>
        <p class="gf4-legend">F₄: ${GF4_LEGEND}</p>
        ${solved ? '<p class="clear-msg">★ すべて消灯！ ★</p>' : ''}
        <div class="touch-controls">
          <button class="touch-btn" data-action="press">反転</button>
          <button class="touch-btn" data-action="undo">一手戻す</button>
          <button class="touch-btn" data-action="scramble">解ける配置</button>
          <button class="touch-btn" data-action="arbitrary">無作為な配置</button>
          <button class="touch-btn" data-action="toggleFlip">反転モード切替</button>
          <button class="touch-btn" data-action="clear">全消灯</button>
          ${fromGame ? '<button class="touch-btn" data-action="exitAnalysis">ゲームへ戻る</button>' : ''}
        </div>
        <button class="touch-btn touch-btn--wide" data-action="quit">メニュー</button>
      `;

    } else if (showAnalysis) {
      return `
        <p class="keybinds">hjkl / ←↓↑→ 移動　Space/Enter 反転　U 一手戻す　R やり直す　Q メニュー</p>
        <p class="keybinds"><span class="key">[\\]</span> GF₄ 表示オン/オフ</p>
        <p class="gf4-legend">F₄: ${GF4_LEGEND}</p>
        ${solved ? `
          <p class="clear-msg">★ CLEAR！すべて消灯！手数: ${moves} ★</p>
          <p class="keybinds">[R] もう一度 &nbsp; [Q] メニューへ</p>
        ` : ''}
        <div class="touch-controls">
          <button class="touch-btn" data-action="press">反転</button>
          <button class="touch-btn" data-action="undo">一手戻す</button>
          <button class="touch-btn" data-action="restart">やり直す</button>
          <button class="touch-btn" data-action="toggleGF4">GF₄ OFF</button>
        </div>
        <button class="touch-btn touch-btn--wide" data-action="quit">メニュー</button>
      `;

    } else if (solved) {
      return `
        <p class="clear-msg">★ CLEAR！すべて消灯！手数: ${moves} ★</p>
        <p class="keybinds">[R] もう一度 &nbsp; [Q] メニューへ</p>
        <div class="touch-controls">
          <button class="touch-btn" data-action="restart">もう一度</button>
        </div>
        <button class="touch-btn touch-btn--wide" data-action="quit">メニュー</button>
      `;

    } else {
      return `
        <p class="keybinds">hjkl / ←↓↑→ 移動　Space/Enter 反転　U 一手戻す　R やり直す　Q メニュー</p>
        <p class="legend"><span class="cell lit">■</span> 点灯 &nbsp; <span class="cell">□</span> 消灯</p>
        <div class="touch-controls">
          <button class="touch-btn" data-action="press">反転</button>
          <button class="touch-btn" data-action="undo">一手戻す</button>
          <button class="touch-btn" data-action="restart">やり直す</button>
        </div>
        <button class="touch-btn touch-btn--wide" data-action="quit">メニュー</button>
        <button class="touch-btn touch-btn--hidden touch-btn--wide" data-action="enterAnalysis"></button>
      `;
    }
  }

  // ── Canvas 描画 ───────────────────────────────────────────────

  _drawBoard(canvas, board, showGF4) {
    const PAD  = 8;
    const totalCols = board.cols + (showGF4 ? 1 : 0);
    const availW = Math.min(window.innerWidth - 40, 652);
    const CELL = Math.max(12, Math.min(38, Math.floor((availW - PAD) / totalCols) - PAD));
    const dpr  = window.devicePixelRatio || 1;

    canvas.dataset.cellSize = CELL;
    canvas.dataset.padSize  = PAD;

    const logW = PAD + board.cols * (CELL + PAD) + (showGF4 ? CELL + PAD : 0);
    const logH = PAD + board.rows * (CELL + PAD) + (showGF4 ? CELL + PAD : 0);

    canvas.width  = logW * dpr;
    canvas.height = logH * dpr;
    canvas.style.width  = logW + 'px';
    canvas.style.height = logH + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, logW, logH);

    // 黒背景
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, logW, logH);

    // グリッド線（細いシアン）
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.15)';
    ctx.lineWidth = 1;
    for (let col = 0; col <= board.cols; col++) {
      const lx = PAD / 2 + col * (CELL + PAD);
      ctx.beginPath();
      ctx.moveTo(lx, PAD / 2);
      ctx.lineTo(lx, PAD / 2 + board.rows * (CELL + PAD));
      ctx.stroke();
    }
    for (let row = 0; row <= board.rows; row++) {
      const ly = PAD / 2 + row * (CELL + PAD);
      ctx.beginPath();
      ctx.moveTo(PAD / 2, ly);
      ctx.lineTo(PAD / 2 + board.cols * (CELL + PAD), ly);
      ctx.stroke();
    }
    ctx.restore();

    for (let r = 0; r < board.rows; r++) {
      for (let c = 0; c < board.cols; c++) {
        const x = PAD + c * (CELL + PAD);
        const y = PAD + r * (CELL + PAD);
        this._drawCell(ctx, board, r, c, x, y, CELL);
      }
    }

    if (showGF4) {
      ctx.font = `bold ${Math.floor(CELL * 0.38)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // 右列: 行和
      const gx = PAD + board.cols * (CELL + PAD) + CELL / 2;
      for (let r = 0; r < board.rows; r++) {
        const gy  = PAD + r * (CELL + PAD) + CELL / 2;
        const val = board.gf4RowSum(r);
        ctx.fillStyle = GF4_COLORS[val];
        ctx.fillText(GF4_SYMS[val], gx, gy);
      }

      // 下行: 列和
      const gy2 = PAD + board.rows * (CELL + PAD) + CELL / 2;
      for (let c = 0; c < board.cols; c++) {
        const gx2 = PAD + c * (CELL + PAD) + CELL / 2;
        const val = board.gf4ColSum(c);
        ctx.fillStyle = GF4_COLORS[val];
        ctx.fillText(GF4_SYMS[val], gx2, gy2);
      }
    }
  }

  _drawCell(ctx, board, r, c, x, y, size) {
    const lit   = board.cells[r][c];
    const cur   = r === board.curRow && c === board.curCol;
    const outer = board.isOuterCell(r, c);
    const radius = 2;

    let fillColor, shadowColor, shadowBlur;

    if (outer) {
      if (lit) {
        fillColor   = '#005f6b';
        shadowColor = '#00e5ff';
        shadowBlur  = 4;
      } else {
        fillColor   = '#0d0d0d';
        shadowColor = 'transparent';
        shadowBlur  = 0;
      }
    } else {
      if (lit) {
        fillColor   = '#ff2a8a';
        shadowColor = '#ff2a8a';
        shadowBlur  = 4;
      } else {
        fillColor   = '#111111';
        shadowColor = 'transparent';
        shadowBlur  = 0;
      }
    }

    // セル本体
    ctx.save();
    ctx.shadowColor = shadowColor;
    ctx.shadowBlur  = shadowBlur;
    ctx.fillStyle   = fillColor;
    this._roundRect(ctx, x, y, size, size, radius);
    ctx.fill();
    ctx.restore();

    // OFFセルの微ハイライト（上辺の薄い線）
    if (!lit) {
      ctx.save();
      ctx.strokeStyle = outer ? '#0a0a40' : '#282828';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(x + radius, y + 1.5);
      ctx.lineTo(x + size - radius, y + 1.5);
      ctx.stroke();
      ctx.restore();
    }

    // カーソルアウトライン（シアン矩形）
    if (cur) {
      ctx.save();
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth   = 2;
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur  = 4;
      ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
      ctx.restore();
    }
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }
  }
}
