"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { trackView } from "@/lib/track";

// パスが変わるたびにページ閲覧(view)を1回記録する。
// 自動更新（1分ごとのデータ再取得）ではパスが変わらないので送られない。
export default function AnalyticsTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    // 管理画面（/admin 配下）は解析対象外＝管理者自身のアクセスは記録しない
    if (pathname.startsWith("/admin")) return;
    trackView(pathname);
  }, [pathname]);

  return null;
}
