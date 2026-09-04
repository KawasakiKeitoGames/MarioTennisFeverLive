// =====================================================================
// 国コード(ISO 3166-1 alpha-2) → 日本語の国名。
// 管理画面のアクセス解析は Vercel の x-vercel-ip-country（2文字コード）を
// そのまま保存しているため、表示のときだけ日本語に直す。
// 基本は Intl.DisplayNames(ja) に任せ、正式名が長い/馴染みの薄いものだけ上書き。
// =====================================================================

const OVERRIDES: Record<string, string> = {
  US: "アメリカ",
  GB: "イギリス",
  KR: "韓国",
  KP: "北朝鮮",
  TW: "台湾",
  HK: "香港",
  MO: "マカオ",
  RU: "ロシア",
  VN: "ベトナム",
  CZ: "チェコ",
  NL: "オランダ",
  CH: "スイス",
  VA: "バチカン",
  AE: "UAE",
};

// Intl.DisplayNames は生成コストがあるので使い回す（ICU縮小構成なら null）。
let cached: Intl.DisplayNames | null | undefined;
function regionNames(): Intl.DisplayNames | null {
  if (cached === undefined) {
    try {
      cached = new Intl.DisplayNames(["ja"], { type: "region" });
    } catch {
      cached = null;
    }
  }
  return cached;
}

/** 国コードを日本語の国名に。不明('??'や空)は「不明」、未知のコードはコードのまま。 */
export function countryJa(code: string | null | undefined): string {
  const c = (code ?? "").trim().toUpperCase();
  if (!c || c === "??" || c === "XX" || c === "T1") return "不明";
  if (!/^[A-Z]{2}$/.test(c)) return c;
  if (OVERRIDES[c]) return OVERRIDES[c];
  try {
    const name = regionNames()?.of(c);
    if (name && name !== c) return name;
  } catch {
    // 未定義のコードは Intl が例外を投げることがある → コードのまま返す
  }
  return c;
}
