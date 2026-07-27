"use client";

import { useEffect } from "react";

// PWA用: Service Worker を登録（インストール可能化＋最低限のオフライン耐性）
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* 登録失敗は無視（PWA非対応環境など） */
      });
    };
    // load 完了後にマウントしても確実に登録されるよう readyState を判定
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);
  return null;
}
