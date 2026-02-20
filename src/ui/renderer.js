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
      : this._menuHTML(state);
  }

  // ── メニュー画面 ──────────────────────────────────────────────

  _menuHTML({ mStep, mRows, mCols, errMsg }) {
    let body = '';

    if (mStep === 'rows') {
      body = `
        <p class="prompt">行数 m を入力してください (2〜20):</p>
        <p class="input-line">m (行数) &gt; <span class="input-val">${h(mRows)}</span><span class="cursor">█</span></p>
      `;

    } else if (mStep === 'cols') {
      body = `
        <p class="sub">m = ${h(mRows)}</p>
        <p class="prompt">列数 n を入力してください (2〜20):</p>
        <p class="input-line">n (列数) &gt; <span class="input-val">${h(mCols)}</span><span class="cursor">█</span></p>
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
            hjkl/↑↓←→ 移動　Space/Enter 反転　U アンドゥ　R リスタート
          </p>
        </div>
        <div class="mode-option">
          <p><span class="key">[2]</span> 数理解析モード</p>
          <p class="mode-desc">
            盤面: ${m + 2} 行 × ${n + 2} 列（外周1マス含む）<br>
            外周セル <span class="cell outer">□</span> は青背景で表示<br>
            S 解ける配置　A 任意配置　hjkl/↑↓←→ 移動　Space/Enter 反転
          </p>
        </div>
        <p class="gf4-legend">F₄: ${GF4_LEGEND}</p>
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
        <table class="board"><tbody>
          ${this._boardRows(board, showGF4)}
          ${showGF4 ? this._gf4ColRow(board) : ''}
        </tbody></table>
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

  // 盤面行（各セル + 右端の GF(4) 行和）
  _boardRows(board, showGF4) {
    let html = '';
    for (let r = 0; r < board.rows; r++) {
      let cells = '';
      for (let c = 0; c < board.cols; c++) {
        cells += this._cellTd(board, r, c);
      }
      if (showGF4) {
        cells += `<td class="gf4-sum">${gf4HTML(board.gf4RowSum(r))}</td>`;
      }
      html += `<tr>${cells}</tr>`;
    }
    return html;
  }

  // GF(4) 列和行（下端）
  _gf4ColRow(board) {
    let cells = '';
    for (let c = 0; c < board.cols; c++) {
      cells += `<td class="gf4-sum">${gf4HTML(board.gf4ColSum(c))}</td>`;
    }
    cells += `<td class="gf4-sum gf4-corner"></td>`;
    return `<tr class="gf4-col-row">${cells}</tr>`;
  }

  // 1 セルの <td>
  _cellTd(board, r, c) {
    const lit   = board.cells[r][c];
    const cur   = r === board.curRow && c === board.curCol;
    const outer = board.isOuterCell(r, c);
    const sym   = lit ? '■' : '□';

    let cls = 'cell';
    if (outer) {
      cls += cur ? ' outer cursor' : (lit ? ' outer lit' : ' outer');
    } else if (cur) {
      cls += lit ? ' cursor lit' : ' cursor';
    } else if (lit) {
      cls += ' lit';
    }

    return `<td class="${cls}">${sym}</td>`;
  }

  // フッター
  _footerHTML(board, showAnalysis, fromGame, solved) {
    const { analysis, singleToggle, moves } = board;

    if (analysis) {
      const toggleLabel = singleToggle ? '1マス反転' : '3×3反転';
      return `
        <p class="keybinds">hjkl / ↑↓←→ 移動　Space/Enter 反転　U アンドゥ　Q メニュー</p>
        ${fromGame ? '<p class="keybinds"><span class="key">[\\]</span> ゲームモードへ戻る</p>' : ''}
        <p class="keybinds">
          <span class="key">S</span> 解ける配置生成（内部操作のみ）&nbsp;
          <span class="key">A</span> 任意配置生成 &nbsp;
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
      `;

    } else if (showAnalysis) {
      return `
        <p class="keybinds">hjkl / ↑↓←→ 移動　Space/Enter 反転　U アンドゥ　R リスタート　Q メニュー</p>
        <p class="keybinds"><span class="key">[\\]</span> GF₄ 表示オン/オフ</p>
        <p class="gf4-legend">F₄: ${GF4_LEGEND}</p>
        ${solved ? `
          <p class="clear-msg">★ CLEAR！すべて消灯！手数: ${moves} ★</p>
          <p class="keybinds">[R] もう一度 &nbsp; [Q] メニューへ</p>
        ` : ''}
      `;

    } else if (solved) {
      return `
        <p class="clear-msg">★ CLEAR！すべて消灯！手数: ${moves} ★</p>
        <p class="keybinds">[R] もう一度 &nbsp; [Q] メニューへ</p>
      `;

    } else {
      return `
        <p class="keybinds">hjkl / ↑↓←→ 移動　Space/Enter 反転　U アンドゥ　R リスタート　Q メニュー</p>
        <p class="legend"><span class="cell lit">■</span> 点灯 &nbsp; <span class="cell">□</span> 消灯</p>
      `;
    }
  }
}
