"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function run(
    key: string,
    url: string,
    okText: string,
    confirmText?: string,
  ) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(key);
    setMsg(null);
    try {
      const res = await fetch(url, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "失敗しました");
      setMsg({ text: okText, ok: true });
      router.refresh();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "失敗しました", ok: false });
    } finally {
      setBusy(null);
    }
  }

  return { busy, msg, run };
}

export function Toolbar() {
  const { busy, msg, run } = useAction();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => run("collect", "/api/admin/collect", "収集を実行しました")}
        disabled={busy !== null}
        className="rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white transition-opacity disabled:opacity-50"
      >
        {busy === "collect" ? "収集中…" : "今すぐ収集"}
      </button>
      <button
        onClick={() =>
          run(
            "prune",
            "/api/admin/prune",
            "30日より古いデータを削除しました",
            "30日より古いスナップショットを削除します。よろしいですか？",
          )
        }
        disabled={busy !== null}
        className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
      >
        {busy === "prune" ? "削除中…" : "古いデータを掃除"}
      </button>
      <button
        onClick={() => run("logout", "/api/admin/logout", "")}
        disabled={busy !== null}
        className="ml-auto rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-50"
      >
        ログアウト
      </button>
      {msg && (
        <div
          className={`w-full rounded-lg px-3 py-2 text-xs ${
            msg.ok
              ? "border border-brand/30 bg-brand/10 text-brand"
              : "border border-red-200 bg-red-50 text-red-600"
          }`}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}

export function DeleteSnapshotButton({ id }: { id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function del() {
    if (!window.confirm("このスナップショットを削除しますか？")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/delete-snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "削除に失敗しました");
      }
      router.refresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "削除に失敗しました");
      setBusy(false);
    }
  }

  return (
    <button
      onClick={del}
      disabled={busy}
      className="rounded-md px-2 py-0.5 text-[11px] font-bold text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
    >
      {busy ? "…" : "削除"}
    </button>
  );
}
