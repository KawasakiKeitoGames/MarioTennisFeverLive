"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

export interface PointRow {
  label: string; // 日別なら "M/D"、時間別なら "13時"
  PV: number;
  クリック: number;
}

export default function AnalyticsChart({ data }: { data: PointRow[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center text-sm text-slate-400">
        この期間のデータはまだありません。
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: -12 }}>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
        <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} minTickGap={24} stroke="#e2e8f0" />
        <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} stroke="#e2e8f0" />
        <Tooltip
          contentStyle={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            color: "#0f172a",
            fontSize: 12,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: "#475569" }} />
        <Line type="monotone" dataKey="PV" stroke="#16a34a" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="クリック" stroke="#0ea5e9" strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
