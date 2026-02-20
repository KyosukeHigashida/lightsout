// GF(4) = GF(2)[x]/(x²+x+1)
// 元: 0, 1, ω, ω²  (ω³=1, ω²=ω+1)
// 加算 = XOR; 乗算 = ルックアップテーブル

export const G0   = 0; // 0
export const G1   = 1; // 1
export const GOm  = 2; // ω
export const GOm2 = 3; // ω²

const MUL_TABLE = [
  [0, 0, 0, 0],
  [0, 1, 2, 3],
  [0, 2, 3, 1],
  [0, 3, 1, 2],
];

export function gf4Add(a, b) { return a ^ b; }
export function gf4Mul(a, b) { return MUL_TABLE[a][b]; }

// ω^n (n >= 0) を返す。ω^0=1, ω^1=ω, ω^2=ω², ω^3=1, ...
export function gf4Pow(n) {
  switch (((n % 3) + 3) % 3) {
    case 0: return G1;
    case 1: return GOm;
    default: return GOm2;
  }
}
