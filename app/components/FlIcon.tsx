/**
 * FEVER LIVE の自作アイコン（絵文字の置き換え）。SENSEKI FEVER の components/SfIcon.tsx と同じ方針。
 *
 *  - 線だけ・色は currentColor を継承する。置いた場所の文字色をそのまま拾うので、
 *    globals.css のダークテーマ層に追記しなくても勝手に追従する。
 *  - 24×24 グリッド・線幅 1.65・端と角は丸。
 *  - 絵が要らない場所には足さない。見出しやリンクの頭にぶら下がっていただけの絵文字は
 *    文字だけにしてある（隣の文字が同じことを言っているため）。
 *  - 10px級のバッジには使わない。小さすぎて字形が潰れるので、そこは ▲▼ のような
 *    組版記号か文字だけで済ませる。
 */

export type FlIconName =
  | "sun" // ライトテーマへ切り替え
  | "moon" // ダークテーマへ切り替え
  | "trophy" // 配信者ページの順位
  | "warn"; // 管理ページの警告

const PATHS: Record<FlIconName, React.ReactNode> = {
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.8v2.2M12 19v2.2M2.8 12h2.2M19 12h2.2" />
      <path d="M5.5 5.5l1.6 1.6M16.9 16.9l1.6 1.6M18.5 5.5l-1.6 1.6M7.1 16.9l-1.6 1.6" />
    </>
  ),
  moon: (
    <>
      <path d="M20.4 14.6A8.6 8.6 0 0 1 9.4 3.6a8.6 8.6 0 1 0 11 11Z" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 4.4h8v4.2a4 4 0 0 1-8 0Z" />
      <path d="M8 5.6H5.4v1.1a3 3 0 0 0 3 3" />
      <path d="M16 5.6h2.6v1.1a3 3 0 0 1-3 3" />
      <path d="M12 12.6v3" />
      <path d="M8.8 19.6h6.4l-.7-3a1.1 1.1 0 0 0-1.07-.85h-2.86A1.1 1.1 0 0 0 9.5 16.6Z" />
    </>
  ),
  warn: (
    <>
      <path d="M12 4.1 21.2 19.4a1 1 0 0 1-.86 1.5H3.66a1 1 0 0 1-.86-1.5Z" />
      <path d="M12 10.4v4" />
      <circle cx="12" cy="17.6" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
};

export default function FlIcon({
  name,
  size = 16,
  className,
}: {
  name: FlIconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={{ display: "block", flexShrink: 0 }}
      aria-hidden="true"
      focusable="false"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {PATHS[name]}
      </g>
    </svg>
  );
}
