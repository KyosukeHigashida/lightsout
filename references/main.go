package main

import (
	"fmt"
	"math/rand"
	"os"
	"strconv"
	"strings"
	"time"

	"golang.org/x/term"
)

// ── ANSI ──────────────────────────────────────────────────────

const (
	ansiClear    = "\033[2J\033[H"
	ansiHide     = "\033[?25l"
	ansiShow     = "\033[?25h"
	ansiReset    = "\033[0m"
	ansiBold     = "\033[1m"
	ansiRed      = "\033[31m"
	ansiGreen    = "\033[32m"
	ansiYellow   = "\033[33m"
	ansiGray     = "\033[90m"
	ansiYellowBG = "\033[43;30m"
	ansiReverse  = "\033[7m"

	// 解析モード外周セルの背景色
	outerUnlit = "\033[44;37m" // 青背景・白文字 (消灯)
	outerLit   = "\033[46;30m" // シアン背景・黒文字 (点灯)

	// GF(4) 元の 4 色
	colorG0   = "\033[90m" // 0  → ダークグレー
	colorG1   = "\033[96m" // 1  → ブライトシアン
	colorGOm  = "\033[33m" // ω  → イエロー
	colorGOm2 = "\033[95m" // ω² → ブライトマゼンタ
)

// ── GF(4) ─────────────────────────────────────────────────────
//
// GF(4) = GF(2)[x]/(x²+x+1)
// 元: 0, 1, ω, ω²  (ω³=1, ω²=ω+1)
// 加算 = XOR ; 乗算 = ルックアップテーブル

type GF4 = uint8

const (
	G0   GF4 = 0
	G1   GF4 = 1
	GOm  GF4 = 2 // ω
	GOm2 GF4 = 3 // ω²
)

var gf4MulTable = [4][4]GF4{
	{0, 0, 0, 0},
	{0, 1, 2, 3},
	{0, 2, 3, 1},
	{0, 3, 1, 2},
}

func gf4Add(a, b GF4) GF4 { return a ^ b }
func gf4Mul(a, b GF4) GF4 { return gf4MulTable[a][b] }

// gf4Pow は ω^n (n≥0) を返す。
func gf4Pow(n int) GF4 {
	switch n % 3 {
	case 0:
		return G1
	case 1:
		return GOm
	default:
		return GOm2
	}
}

func gf4Color(v GF4) string {
	switch v {
	case G0:
		return colorG0
	case G1:
		return colorG1
	case GOm:
		return colorGOm
	default:
		return colorGOm2
	}
}

// gf4Sym は 3 表示列幅の記号を返す。
func gf4Sym(v GF4) string {
	switch v {
	case G0:
		return " 0 "
	case G1:
		return " 1 "
	case GOm:
		return " ω "
	default:
		return "ω² "
	}
}

func gf4Str(v GF4) string { return gf4Color(v) + gf4Sym(v) + ansiReset }

// ── モード / メニューステップ ──────────────────────────────────

type Mode int

const (
	ModeMenu Mode = iota
	ModeGame
)

type MenuStep int

const (
	StepRows MenuStep = iota
	StepCols
	StepMode
)

// ── ゲーム状態 ─────────────────────────────────────────────────

type Game struct {
	mode     Mode
	rows     int // 盤の実際の行数 (解析モードでは mRows+1)
	cols     int // 盤の実際の列数 (解析モードでは mCols+1)
	board    [][]bool
	curRow   int
	curCol   int
	history  [][][]bool
	moves    int
	analysis     bool
	showAnalysis bool // GF(4) オーバーレイ表示フラグ (ゲームモード中に隠しコマンドで切替)
	singleToggle bool // 解析モード: true=1マス反転, false=3×3反転
	fromGame     bool // 解析モードへゲームモードから遷移した場合 true

	// メニュー状態 (ユーザが入力した m, n を保持)
	mStep  MenuStep
	mRows  string // ユーザ入力 m (行数)
	mCols  string // ユーザ入力 n (列数)
	errMsg string

	rng *rand.Rand
}

func newGame() *Game {
	return &Game{
		mode: ModeMenu,
		rng:  rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

func (g *Game) allocBoard(rows, cols int) {
	g.rows = rows
	g.cols = cols
	g.board = make([][]bool, rows)
	for i := range g.board {
		g.board[i] = make([]bool, cols)
	}
}

func (g *Game) clearBoard() {
	for r := range g.board {
		for c := range g.board[r] {
			g.board[r][c] = false
		}
	}
}

// isOuterCell は解析モードで外周セルかどうかを返す。
// 外周 = row==0, row==rows-1, col==0, col==cols-1
func (g *Game) isOuterCell(r, c int) bool {
	if !g.analysis {
		return false
	}
	return r == 0 || r == g.rows-1 || c == 0 || c == g.cols-1
}

// innerBounds は解析モードの内部セル範囲を返す。
// 内部: rows [1, g.rows-2], cols [1, g.cols-2]
func (g *Game) innerBounds() (rMin, rMax, cMin, cMax int) {
	return 1, g.rows - 2, 1, g.cols - 2
}

// scrambleSolvable は全セルにランダム合法手を適用して必ず解けるパズルを生成する。
func (g *Game) scrambleSolvable() {
	g.clearBoard()
	for i := 0; i < g.rows*g.cols*3; i++ {
		g.doToggle(g.rng.Intn(g.rows), g.rng.Intn(g.cols))
	}
	if g.isSolved() {
		g.board[g.rows/2][g.cols/2] = true
	}
	g.history = nil
	g.moves = 0
	g.curRow, g.curCol = 0, 0
}

// scrambleSolvableInner は解析モード専用。
// 内部セル (rows 1..rows-2, cols 1..cols-2) のボタン操作のみで
// 全消灯できる配置を生成する。
func (g *Game) scrambleSolvableInner() {
	g.clearBoard()
	rMin, rMax, cMin, cMax := g.innerBounds()
	innerR := rMax - rMin + 1
	innerC := cMax - cMin + 1
	if innerR > 0 && innerC > 0 {
		for i := 0; i < innerR*innerC*3; i++ {
			r := rMin + g.rng.Intn(innerR)
			c := cMin + g.rng.Intn(innerC)
			g.doToggle(r, c)
		}
	}
	if g.isSolved() {
		// 内部中央セルを点灯して全消灯を回避
		g.board[(rMin+rMax)/2][(cMin+cMax)/2] = true
	}
	g.history = nil
	g.moves = 0
	if g.analysis {
		g.curRow, g.curCol = 1, 1
	} else {
		g.curRow, g.curCol = 0, 0
	}
}

// scrambleArbitrary はランダムに点灯状態を設定する（解けるとは限らない）。
func (g *Game) scrambleArbitrary() {
	for r := range g.board {
		for c := range g.board[r] {
			g.board[r][c] = g.rng.Intn(2) == 1
		}
	}
	if g.isSolved() {
		g.board[0][0] = true
	}
	g.history = nil
	g.moves = 0
	if g.analysis {
		rMin, _, cMin, _ := g.innerBounds()
		g.curRow = rMin
		g.curCol = cMin
	}
}

// doSingleToggle は (row,col) のみを反転する（1マス反転）。
func (g *Game) doSingleToggle(row, col int) {
	g.board[row][col] = !g.board[row][col]
}

// doToggle は (row,col) と8近傍（盤面内のみ）を反転する。
func (g *Game) doToggle(row, col int) {
	for dr := -1; dr <= 1; dr++ {
		for dc := -1; dc <= 1; dc++ {
			r, c := row+dr, col+dc
			if r >= 0 && r < g.rows && c >= 0 && c < g.cols {
				g.board[r][c] = !g.board[r][c]
			}
		}
	}
}

func (g *Game) pushHistory() {
	snap := make([][]bool, g.rows)
	for i, row := range g.board {
		snap[i] = make([]bool, g.cols)
		copy(snap[i], row)
	}
	g.history = append(g.history, snap)
}

func (g *Game) undo() {
	n := len(g.history)
	if n == 0 {
		return
	}
	snap := g.history[n-1]
	g.history = g.history[:n-1]
	for i := range g.board {
		copy(g.board[i], snap[i])
	}
	if g.moves > 0 {
		g.moves--
	}
}

func (g *Game) isSolved() bool {
	for _, row := range g.board {
		for _, v := range row {
			if v {
				return false
			}
		}
	}
	return true
}

// moveCursor はカーソルを盤面内でクランプしながら移動する。
func (g *Game) moveCursor(dr, dc int) {
	newR := g.curRow + dr
	newC := g.curCol + dc
	if newR < 0 {
		newR = 0
	}
	if newR >= g.rows {
		newR = g.rows - 1
	}
	if newC < 0 {
		newC = 0
	}
	if newC >= g.cols {
		newC = g.cols - 1
	}
	g.curRow = newR
	g.curCol = newC
}

// ── GF(4) 重み付き和 ───────────────────────────────────────────

func (g *Game) gf4RowSum(r int) GF4 {
	var sum GF4 = G0
	for c := 0; c < g.cols; c++ {
		if g.board[r][c] {
			sum = gf4Add(sum, gf4Pow(r+c))
		}
	}
	return sum
}

func (g *Game) gf4ColSum(c int) GF4 {
	var sum GF4 = G0
	for r := 0; r < g.rows; r++ {
		if g.board[r][c] {
			sum = gf4Add(sum, gf4Pow(r+c))
		}
	}
	return sum
}

// ── レンダリング ───────────────────────────────────────────────

func borderLine(l, mid, r, cell string, n int) string {
	parts := make([]string, n)
	for i := range parts {
		parts[i] = cell
	}
	return l + strings.Join(parts, mid) + r + "\r\n"
}

// cellStr は1セルの色付き文字列を返す。
// 解析モードの外周セルは青/シアン背景で表示する。
func (g *Game) cellStr(row, col int) string {
	lit := g.board[row][col]
	cur := row == g.curRow && col == g.curCol
	sym := " □ "
	if lit {
		sym = " ■ "
	}

	if g.isOuterCell(row, col) {
		// 外周セル: カーソルあり → 明黄背景で視認、なし → 青/シアン背景
		if cur {
			return "\033[103;30m" + sym + ansiReset // 明黄背景・黒文字
		}
		if lit {
			return outerLit + sym + ansiReset
		}
		return outerUnlit + sym + ansiReset
	}

	// 内部セル
	switch {
	case cur && lit:
		return ansiYellowBG + sym + ansiReset
	case cur && !lit:
		return ansiReverse + sym + ansiReset
	case lit:
		return ansiYellow + sym + ansiReset
	default:
		return ansiGray + sym + ansiReset
	}
}

// ── メニュー描画 ───────────────────────────────────────────────


// ── 解析モード遷移（ゲーム→解析） ─────────────────────────────

type rc struct{ r, c int }

// enterAnalysisFromGame は、現在のゲーム盤面 (m×n) を (m+2)×(n+2) の解析盤面に埋め込み、
// 外周セルを 0/1 で設定して GF(4) の全行・全列の重み和が 0 になるようにする。
func (g *Game) enterAnalysisFromGame() {
	// 既存盤面を退避
	oldRows, oldCols := g.rows, g.cols
	old := make([][]bool, oldRows)
	for r := range old {
		old[r] = make([]bool, oldCols)
		copy(old[r], g.board[r])
	}

	// 解析盤面を確保して内部をコピー
	g.analysis = true
	g.fromGame = true
	g.showAnalysis = false // 解析モードでは常に GF(4) を表示する
	g.allocBoard(oldRows+2, oldCols+2)

	for r := 0; r < oldRows; r++ {
		for c := 0; c < oldCols; c++ {
			g.board[r+1][c+1] = old[r][c]
		}
	}

	// 外周を GF(4) 行/列和が全て 0 になるように埋める
	g.fillOuterToZeroGF4()

	g.history = nil
	g.moves = 0
	g.curRow, g.curCol = 1, 1
}

// returnToGameFromAnalysis は解析モードから元のゲームモードへ戻る。
// 解析盤面の内部セル（外周を除いた m×n 部分）の現在の状態を復元する。
func (g *Game) returnToGameFromAnalysis() {
	m := g.rows - 2
	n := g.cols - 2

	inner := make([][]bool, m)
	for r := 0; r < m; r++ {
		inner[r] = make([]bool, n)
		copy(inner[r], g.board[r+1][1:n+1])
	}

	g.analysis = false
	g.fromGame = false
	g.singleToggle = false
	g.allocBoard(m, n)
	for r := 0; r < m; r++ {
		copy(g.board[r], inner[r])
	}

	g.history = nil
	g.moves = 0
	g.curRow, g.curCol = 0, 0
}

// fillOuterToZeroGF4 は、現在の内部セル（外周以外）を固定したまま、外周セルを 0/1 で設定し、
// 全ての行・列について GF(4) 重み和が 0 になるようにする。
func (g *Game) fillOuterToZeroGF4() {
	if !g.analysis || g.rows < 3 || g.cols < 3 {
		return
	}

	// 変数 = 外周セル
	var vars []rc
	idx := make(map[rc]int)

	for r := 0; r < g.rows; r++ {
		for c := 0; c < g.cols; c++ {
			if r == 0 || r == g.rows-1 || c == 0 || c == g.cols-1 {
				p := rc{r, c}
				idx[p] = len(vars)
				vars = append(vars, p)
			}
		}
	}
	nVars := len(vars)
	if nVars == 0 {
		return
	}

	// 内部セルだけを固定項として扱うため、一旦外周を false にして内部和を計算する
	outerSnapshot := make([]bool, nVars)
	for i, p := range vars {
		outerSnapshot[i] = g.board[p.r][p.c]
		g.board[p.r][p.c] = false
	}

	internalRow := make([]GF4, g.rows)
	internalCol := make([]GF4, g.cols)
	for r := 0; r < g.rows; r++ {
		internalRow[r] = g.gf4RowSum(r)
	}
	for c := 0; c < g.cols; c++ {
		internalCol[c] = g.gf4ColSum(c)
	}

	// 連立一次方程式を構築して解く（GF(4) を 2-bit の GF(2) 方程式へ落とす）
	eqs := buildGF4ZeroSystem(g.rows, g.cols, vars, idx, internalRow, internalCol)
	sol, ok := solveGF2(eqs, nVars)
	if !ok {
		// 解けない場合は外周を元に戻す（通常起きない想定）
		for i, p := range vars {
			g.board[p.r][p.c] = outerSnapshot[i]
		}
		return
	}

	for i, p := range vars {
		g.board[p.r][p.c] = sol[i]
	}
}

// ── GF(2) 線形方程式ソルバ ────────────────────────────────────

// gf2Eq は GF(2) 上の一次方程式 (bitset · x = rhs) を表す。
type gf2Eq struct {
	bits []uint64
	rhs  uint8
}

// buildGF4ZeroSystem は、GF(4) の行/列和ゼロ条件を GF(2) の連立一次方程式に落とす。
func buildGF4ZeroSystem(rows, cols int, vars []rc, idx map[rc]int, internalRow, internalCol []GF4) []gf2Eq {
	nVars := len(vars)
	words := (nVars + 63) / 64
	setBit := func(bs []uint64, i int) {
		bs[i>>6] |= 1 << (uint(i) & 63)
	}

	var eqs []gf2Eq

	// 行制約
	for r := 0; r < rows; r++ {
		for bit := 0; bit < 2; bit++ {
			bs := make([]uint64, words)
			for c := 0; c < cols; c++ {
				if r == 0 || r == rows-1 || c == 0 || c == cols-1 {
					i, ok := idx[rc{r, c}]
					if !ok {
						continue
					}
					coef := gf4Pow(r + c)
					if ((coef >> bit) & 1) == 1 {
						setBit(bs, i)
					}
				}
			}
			rhs := uint8((internalRow[r] >> bit) & 1)
			eqs = append(eqs, gf2Eq{bits: bs, rhs: rhs})
		}
	}

	// 列制約
	for c := 0; c < cols; c++ {
		for bit := 0; bit < 2; bit++ {
			bs := make([]uint64, words)
			for r := 0; r < rows; r++ {
				if r == 0 || r == rows-1 || c == 0 || c == cols-1 {
					i, ok := idx[rc{r, c}]
					if !ok {
						continue
					}
					coef := gf4Pow(r + c)
					if ((coef >> bit) & 1) == 1 {
						setBit(bs, i)
					}
				}
			}
			rhs := uint8((internalCol[c] >> bit) & 1)
			eqs = append(eqs, gf2Eq{bits: bs, rhs: rhs})
		}
	}

	return eqs
}

// solveGF2 は GF(2) の連立一次方程式をガウス消去で解く。
// 解が存在すれば x を返し、存在しなければ ok=false。
func solveGF2(eqs []gf2Eq, nVars int) (x []bool, ok bool) {
	words := (nVars + 63) / 64
	A := make([]gf2Eq, len(eqs))
	for i := range eqs {
		bs := make([]uint64, words)
		copy(bs, eqs[i].bits)
		A[i] = gf2Eq{bits: bs, rhs: eqs[i].rhs}
	}

	testBit := func(bs []uint64, j int) uint64 {
		return (bs[j>>6] >> (uint(j) & 63)) & 1
	}
	xorRow := func(dst, src []uint64) {
		for k := range dst {
			dst[k] ^= src[k]
		}
	}

	pivRow := 0
	pivCols := make([]int, 0, minInt(len(A), nVars))

	for col := 0; col < nVars && pivRow < len(A); col++ {
		// pivot 探索
		p := -1
		for r := pivRow; r < len(A); r++ {
			if testBit(A[r].bits, col) == 1 {
				p = r
				break
			}
		}
		if p == -1 {
			continue
		}
		A[pivRow], A[p] = A[p], A[pivRow]
		pivCols = append(pivCols, col)

		// 消去
		for r := 0; r < len(A); r++ {
			if r == pivRow {
				continue
			}
			if testBit(A[r].bits, col) == 1 {
				xorRow(A[r].bits, A[pivRow].bits)
				A[r].rhs ^= A[pivRow].rhs
			}
		}

		pivRow++
	}

	// 矛盾チェック
	for r := 0; r < len(A); r++ {
		all0 := true
		for k := 0; k < words; k++ {
			if A[r].bits[k] != 0 {
				all0 = false
				break
			}
		}
		if all0 && A[r].rhs == 1 {
			return nil, false
		}
	}

	// 既に RREF に近いので後退代入
	x = make([]bool, nVars)
	xBits := make([]uint64, words)

	for i := len(pivCols) - 1; i >= 0; i-- {
		col := pivCols[i]
		row := i

		// pivot列を除いた dot を取る
		var s uint8 = 0
		for k := 0; k < words; k++ {
			w := A[row].bits[k] & xBits[k]
			s ^= uint8(bitsOnesParity(w))
		}
		// pivot 自身の寄与を除外
		if ((xBits[col>>6] >> (uint(col) & 63)) & 1) == 1 {
			// まだ未確定なのでここには来ないが、念のため
		}
		// pivot ビットを落として再計算
		bs := make([]uint64, words)
		copy(bs, A[row].bits)
		bs[col>>6] &^= 1 << (uint(col) & 63)
		s = 0
		for k := 0; k < words; k++ {
			w := bs[k] & xBits[k]
			s ^= uint8(bitsOnesParity(w))
		}

		val := A[row].rhs ^ s
		if val == 1 {
			x[col] = true
			xBits[col>>6] |= 1 << (uint(col) & 63)
		}
	}

	return x, true
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// bitsOnesParity は popcount(x) mod 2 を返す。
func bitsOnesParity(x uint64) uint64 {
	x ^= x >> 32
	x ^= x >> 16
	x ^= x >> 8
	x ^= x >> 4
	x ^= x >> 2
	x ^= x >> 1
	return x & 1
}

func (g *Game) renderMenu() string {
	var sb strings.Builder
	sb.WriteString(ansiClear + "\r\n")
	sb.WriteString(ansiBold +
		"  ╔═══════════════════════════╗\r\n" +
		"  ║    L I G H T S  O U T     ║\r\n" +
		"  ╚═══════════════════════════╝\r\n" + ansiReset)
	sb.WriteString("\r\n")

	switch g.mStep {
	case StepRows:
		sb.WriteString("  行数 m を入力してください (2〜20):\r\n\r\n")
		sb.WriteString("  m (行数) > " + g.mRows + ansiBold + "█" + ansiReset + "\r\n")

	case StepCols:
		sb.WriteString("  列数 n を入力してください (2〜20):\r\n\r\n")
		sb.WriteString(fmt.Sprintf("  m = %s\r\n", g.mRows))
		sb.WriteString("  n (列数) > " + g.mCols + ansiBold + "█" + ansiReset + "\r\n")

	case StepMode:
		sb.WriteString(fmt.Sprintf("  盤面サイズ: m=%s, n=%s\r\n\r\n", g.mRows, g.mCols))
		sb.WriteString("  モードを選択してください:\r\n\r\n")

		sb.WriteString("  " + ansiBold + "[1]" + ansiReset + " ゲームモード\r\n")
		sb.WriteString(fmt.Sprintf("      盤面: %s 行 × %s 列\r\n", g.mRows, g.mCols))
		sb.WriteString("      hjkl/↑↓←→ 移動  Space/Enter 反転  U アンドゥ  R リスタート\r\n\r\n")

		m, _ := strconv.Atoi(g.mRows)
		n, _ := strconv.Atoi(g.mCols)
		sb.WriteString("  " + ansiBold + "[2]" + ansiReset + " 数理解析モード\r\n")
		sb.WriteString(fmt.Sprintf("      盤面: %d 行 × %d 列  (外周1マス含む)\r\n", m+1, n+1))
		sb.WriteString("      外周セル " + outerUnlit + " □ " + ansiReset +
			" は青背景で表示\r\n")
		sb.WriteString("      S 解ける配置 (内部操作のみで全消灯可)  A 任意配置\r\n")
		sb.WriteString("      hjkl/↑↓←→ 移動  Space/Enter 反転\r\n\r\n")

		sb.WriteString("      F₄: ")
		for _, v := range []GF4{G0, G1, GOm, GOm2} {
			sb.WriteString(gf4Str(v) + " ")
		}
		sb.WriteString("\r\n")
	}

	if g.errMsg != "" {
		sb.WriteString("\r\n  " + ansiRed + "! " + g.errMsg + ansiReset + "\r\n")
	}

	sb.WriteString("\r\n")
	switch g.mStep {
	case StepRows, StepCols:
		sb.WriteString("  [Enter] 次へ   [BS] 削除   [Q] 終了\r\n")
	case StepMode:
		sb.WriteString("  [1/2] 選択   [BS] 戻る   [Q] 終了\r\n")
	}

	sb.WriteString("\r\n" + ansiBold + "  【ルール】" + ansiReset +
		" パネルを押すとそのパネルと周囲8マスが反転。すべて消灯させればクリア！\r\n")

	return sb.String()
}

// ── ゲーム盤面描画 ─────────────────────────────────────────────

func (g *Game) renderGame() string {
	var sb strings.Builder
	sb.WriteString(ansiClear + "\r\n")

	solved := g.isSolved()

	// ヘッダー
	if g.analysis {
		sb.WriteString(ansiBold + "  LIGHTS OUT [ANALYSIS]" + ansiReset)
		m, _ := strconv.Atoi(g.mRows)
		n, _ := strconv.Atoi(g.mCols)
		sb.WriteString(fmt.Sprintf("   (%d+2)×(%d+2)=%d×%d  手数: %d",
			m, n, g.rows, g.cols, g.moves))
	} else if g.showAnalysis {
		sb.WriteString(ansiBold + "  LIGHTS OUT" + ansiReset + ansiYellow + " [GF₄]" + ansiReset)
		sb.WriteString(fmt.Sprintf("   %d×%d  手数: %d", g.rows, g.cols, g.moves))
	} else {
		sb.WriteString(ansiBold + "  LIGHTS OUT" + ansiReset)
		sb.WriteString(fmt.Sprintf("   %d×%d  手数: %d", g.rows, g.cols, g.moves))
	}
	if len(g.history) > 0 {
		sb.WriteString("   " + ansiBold + "[U]" + ansiReset)
	}
	sb.WriteString("\r\n\r\n")

	// 解析モードまたはオーバーレイ表示時は右に GF(4) 行和列を追加
	drawCols := g.cols
	if g.analysis || g.showAnalysis {
		drawCols++
	}

	// 上罫線
	sb.WriteString("  " + borderLine("┌", "┬", "┐", "───", drawCols))

	for r := 0; r < g.rows; r++ {
		if r > 0 {
			sb.WriteString("  " + borderLine("├", "┼", "┤", "───", drawCols))
		}
		sb.WriteString("  │")
		for c := 0; c < g.cols; c++ {
			sb.WriteString(g.cellStr(r, c))
			sb.WriteString("│")
		}
		// GF(4) 重み付き行和
		if g.analysis || g.showAnalysis {
			sb.WriteString(gf4Str(g.gf4RowSum(r)))
			sb.WriteString("│")
		}
		sb.WriteString("\r\n")
	}

	// GF(4) 列和行
	if g.analysis || g.showAnalysis {
		sb.WriteString("  " + borderLine("├", "┼", "┤", "───", drawCols))
		sb.WriteString("  │")
		for c := 0; c < g.cols; c++ {
			sb.WriteString(gf4Str(g.gf4ColSum(c)))
			sb.WriteString("│")
		}
		sb.WriteString(ansiGray + "   " + ansiReset + "│\r\n")
	}

	// 下罫線
	sb.WriteString("  " + borderLine("└", "┴", "┘", "───", drawCols))
	sb.WriteString("\r\n")

	// フッター
	if g.analysis {
		sb.WriteString("  hjkl / ↑↓←→ 移動   Space/Enter 反転   U アンドゥ   Q メニュー\r\n")
		if g.fromGame {
			sb.WriteString("  " + ansiBold + "[\\]" + ansiReset + " ゲームモードへ戻る\r\n")
		}
		sb.WriteString("  " + ansiBold + "S" + ansiReset + " 解ける配置生成 (内部操作のみ)   " +
			ansiBold + "A" + ansiReset + " 任意配置生成   " +
			ansiBold + "E" + ansiReset + " 全消灯\r\n")
		toggleLabel := "3×3反転"
		if g.singleToggle {
			toggleLabel = "1マス反転"
		}
		sb.WriteString("  " + ansiBold + "T" + ansiReset + " 反転モード切替: " +
			ansiBold + toggleLabel + ansiReset + "\r\n")
		sb.WriteString("\r\n")
		sb.WriteString("  " + outerUnlit + " □ " + ansiReset + " 外周   " +
			ansiGray + " □ " + ansiReset + " 内部消灯   " +
			ansiYellow + " ■ " + ansiReset + " 内部点灯\r\n")
		sb.WriteString("  F₄: ")
		for _, v := range []GF4{G0, G1, GOm, GOm2} {
			sb.WriteString(gf4Str(v) + " ")
		}
		sb.WriteString("\r\n")
		if solved {
			sb.WriteString("\r\n" + ansiBold + ansiGreen + "  ★ すべて消灯！ ★" + ansiReset + "\r\n")
		}
	} else if g.showAnalysis {
		sb.WriteString("  hjkl / ↑↓←→ 移動   Space/Enter 反転   U アンドゥ   R リスタート   Q メニュー\r\n")
		sb.WriteString("  " + ansiBold + "[\\]" + ansiReset + " GF₄ 表示オン/オフ\r\n")
		sb.WriteString("\r\n  F₄: ")
		for _, v := range []GF4{G0, G1, GOm, GOm2} {
			sb.WriteString(gf4Str(v) + " ")
		}
		sb.WriteString("\r\n")
		if solved {
			sb.WriteString("\r\n" + ansiBold + ansiGreen +
				"  ★ CLEAR！すべて消灯！手数: " + strconv.Itoa(g.moves) + " ★" + ansiReset + "\r\n")
			sb.WriteString("\r\n  [R] もう一度   [Q] メニューへ\r\n")
		}
	} else if solved {
		sb.WriteString(ansiBold + ansiGreen +
			"  ★ CLEAR！すべて消灯！手数: " + strconv.Itoa(g.moves) + " ★\r\n" + ansiReset)
		sb.WriteString("\r\n  [R] もう一度   [Q] メニューへ\r\n")
	} else {
		sb.WriteString("  hjkl / ↑↓←→ 移動   Space/Enter 反転   U アンドゥ   R リスタート   Q メニュー\r\n")
		sb.WriteString("\r\n  " + ansiYellow + "■" + ansiReset + " 点灯   " +
			ansiGray + "□" + ansiReset + " 消灯\r\n")
	}

	return sb.String()
}

// ── 入力ハンドリング ───────────────────────────────────────────

func (g *Game) handleKey(b []byte) bool {
	if len(b) == 0 {
		return true
	}
	if b[0] == 3 || b[0] == 4 {
		return false
	}
	switch g.mode {
	case ModeMenu:
		return g.menuKey(b)
	case ModeGame:
		return g.gameKey(b)
	}
	return true
}

func (g *Game) menuKey(b []byte) bool {
	if len(b) != 1 {
		fmt.Print(g.renderMenu())
		return true
	}
	ch := b[0]
	if ch == 'q' || ch == 'Q' {
		return false
	}

	switch g.mStep {
	case StepRows:
		switch {
		case ch == '\r' || ch == '\n':
			n, err := strconv.Atoi(g.mRows)
			if err != nil || n < 2 || n > 20 {
				g.errMsg = "2〜20 の整数を入力してください"
				g.mRows = ""
			} else {
				g.errMsg = ""
				g.mStep = StepCols
			}
		case ch == 127 || ch == 8:
			if len(g.mRows) > 0 {
				g.mRows = g.mRows[:len(g.mRows)-1]
			}
		case ch >= '0' && ch <= '9':
			if len(g.mRows) < 2 {
				g.mRows += string(ch)
			}
		}

	case StepCols:
		switch {
		case ch == '\r' || ch == '\n':
			n, err := strconv.Atoi(g.mCols)
			if err != nil || n < 2 || n > 20 {
				g.errMsg = "2〜20 の整数を入力してください"
				g.mCols = ""
			} else {
				g.errMsg = ""
				g.mStep = StepMode
			}
		case ch == 127 || ch == 8:
			if len(g.mCols) > 0 {
				g.mCols = g.mCols[:len(g.mCols)-1]
			} else {
				g.mStep = StepRows
				g.errMsg = ""
			}
		case ch >= '0' && ch <= '9':
			if len(g.mCols) < 2 {
				g.mCols += string(ch)
			}
		}

	case StepMode:
		switch ch {
		case '1':
			g.startGame(false)
			return true
		case '2':
			g.startGame(true)
			return true
		case 127, 8:
			g.mStep = StepCols
			g.errMsg = ""
		}
	}

	fmt.Print(g.renderMenu())
	return true
}

func (g *Game) startGame(analysis bool) {
	m, _ := strconv.Atoi(g.mRows)
	n, _ := strconv.Atoi(g.mCols)
	g.analysis = analysis
	if analysis {
		// 解析モード: (m+2)×(n+2) の盤を生成
		g.allocBoard(m+2, n+2)
		g.scrambleSolvableInner()
		g.fillOuterToZeroGF4()
	} else {
		// 通常モード: m×n の盤を生成
		g.allocBoard(m, n)
		g.scrambleSolvable()
	}
	g.mode = ModeGame
	fmt.Print(g.renderGame())
}

func (g *Game) gameKey(b []byte) bool {
	// 矢印キー: ESC [ A/B/C/D
	if len(b) >= 3 && b[0] == 27 && b[1] == '[' {
		switch b[2] {
		case 'A':
			g.moveCursor(-1, 0) // 上
		case 'B':
			g.moveCursor(1, 0) // 下
		case 'C':
			g.moveCursor(0, 1) // 右
		case 'D':
			g.moveCursor(0, -1) // 左
		}
		fmt.Print(g.renderGame())
		return true
	}

	if len(b) != 1 {
		return true
	}
	ch := b[0]

	switch ch {
	case 'q', 'Q':
		g.mode = ModeMenu
		g.mStep = StepMode
		g.errMsg = ""
		fmt.Print(g.renderMenu())
		return true

	case ' ', '\r', '\n':
		if !g.isSolved() || g.analysis {
			g.pushHistory()
			if g.analysis && g.singleToggle {
				g.doSingleToggle(g.curRow, g.curCol)
			} else {
				g.doToggle(g.curRow, g.curCol)
			}
			g.moves++
		}

	case 'u', 'U':
		g.undo()

	// ── hjkl 移動 (vim スタイル) ─────────────────────────────
	case 'h':
		g.moveCursor(0, -1) // 左
	case 'j':
		g.moveCursor(1, 0) // 下
	case 'k':
		g.moveCursor(-1, 0) // 上
	case 'l':
		g.moveCursor(0, 1) // 右

	// ── 隠し: ゲームモードで GF(4) オーバーレイ表示を切り替え ─────────
	case 'g', 'G':
		if !g.analysis {
			g.showAnalysis = !g.showAnalysis
		}

	// ── 解析モード専用: S/A で配置を再生成 ──────────────────────
	case 's', 'S':
		if g.analysis {
			g.scrambleSolvableInner()
		} else {
			// 通常モード: S はリスタート (解ける配置)
			g.scrambleSolvable()
		}

	case 'a', 'A':
		if g.analysis {
			g.scrambleArbitrary()
		}
		// 通常モードでは 'a'/'A' は何もしない (hjkl に統一)

	// ── 解析モード専用: T で反転モード切替 ──────────────────────
	case 't', 'T':
		if g.analysis {
			g.singleToggle = !g.singleToggle
		}

	// ── 解析モード専用: E で全消灯盤面を生成 ────────────────────
	case 'e', 'E':
		if g.analysis {
			g.clearBoard()
			g.history = nil
			g.moves = 0
			g.curRow, g.curCol = 1, 1
		}

	case 'r', 'R':
		if !g.analysis {
			g.scrambleSolvable()
		}

	case '\\':
		// 隠しコマンド: ゲームモード → 数理解析モードへ移行 (外周を追加し、GF(4) 行/列和がすべて 0 になるように外周を充填)
		// 解析モード中 (fromGame=true) の場合はゲームモードへ戻る
		if !g.analysis {
			g.enterAnalysisFromGame()
			fmt.Print(g.renderGame())
			return true
		} else if g.fromGame {
			g.returnToGameFromAnalysis()
			fmt.Print(g.renderGame())
			return true
		}
	}

	fmt.Print(g.renderGame())
	return true
}

// ── ターミナル取得 ─────────────────────────────────────────────

func openTerminal() (*os.File, error) {
	if tty, err := os.OpenFile("/dev/tty", os.O_RDWR, 0); err == nil {
		return tty, nil
	}
	for n := 0; n <= 2; n++ {
		path := fmt.Sprintf("/proc/self/fd/%d", n)
		f, err := os.OpenFile(path, os.O_RDWR, 0)
		if err != nil {
			continue
		}
		if term.IsTerminal(int(f.Fd())) {
			return f, nil
		}
		_ = f.Close()
	}
	return nil, fmt.Errorf(
		"インタラクティブなターミナルが見つかりません\n" +
			"  ターミナルで直接 ./lightsout を実行してください",
	)
}

// ── main ──────────────────────────────────────────────────────

func main() {
	tty, err := openTerminal()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer tty.Close()

	fd := int(tty.Fd())
	oldState, err := term.MakeRaw(fd)
	if err != nil {
		fmt.Fprintln(os.Stderr, "raw モード設定に失敗しました:", err)
		os.Exit(1)
	}
	defer func() {
		_ = term.Restore(fd, oldState)
		fmt.Print(ansiShow + ansiReset + "\r\n")
	}()

	fmt.Print(ansiHide)
	g := newGame()
	fmt.Print(g.renderMenu())

	buf := make([]byte, 16)
	for {
		n, err := tty.Read(buf)
		if err != nil {
			break
		}
		if !g.handleKey(buf[:n]) {
			break
		}
	}

	fmt.Print(ansiClear + ansiShow)
	fmt.Print("\r\nまたね！\r\n")
}
