/**
 * 小さな花のしるし。
 *
 * サイトのモチーフは花屋だが、**コミットグラフには手を出さない**。
 * ノードを花にすると、本物の git log --graph に近い見え方という
 * いちばんの取り柄が崩れるため。花はここと、クリアの合図にだけ出す。
 */
export function Flower({
  size = 16,
  className,
  bloom = false,
}: {
  size?: number;
  className?: string;
  /** 咲いた状態。クリアの合図に使う。 */
  bloom?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      {/* 花びら 5 枚 */}
      {[0, 72, 144, 216, 288].map((deg) => (
        <ellipse
          key={deg}
          cx="12"
          cy="7.4"
          rx="3.1"
          ry="4.4"
          transform={`rotate(${deg} 12 12)`}
          fill={bloom ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.5"
          opacity={bloom ? 0.85 : 1}
        />
      ))}
      <circle cx="12" cy="12" r="2.1" fill="currentColor" />
    </svg>
  );
}

/** 星 1〜3 個。手数の評価に使う。 */
export function Stars({ count, size = 14 }: { count: number; size?: number }) {
  return (
    <span
      className="inline-flex items-center gap-0.5 align-middle"
      role="img"
      aria-label={`星 ${count} つ`}
    >
      {[1, 2, 3].map((n) => (
        <svg key={n} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.5 6.2 20.5l1.1-6.5-4.7-4.6 6.5-.95z"
            fill={n <= count ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
            opacity={n <= count ? 1 : 0.35}
          />
        </svg>
      ))}
    </span>
  );
}
