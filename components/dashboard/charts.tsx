"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const C = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--muted-foreground)",
];
const TIP = {
  contentStyle: {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    fontSize: 12,
    boxShadow: "0 4px 12px oklch(0.2 0.02 255 / .08)",
  },
  labelStyle: { color: "var(--muted-foreground)" },
};
const TICK = { fontSize: 11, fill: "var(--muted-foreground)" };

const compact = (n: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  } catch {
    return String(n);
  }
};
const full = (n: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return String(n);
  }
};
const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en-IN", {
    month: "short",
    timeZone: "UTC",
  });
};

function Empty({ text = "No data in this range" }: { text?: string }) {
  return (
    <p className="text-muted-foreground flex h-full items-center justify-center text-xs">{text}</p>
  );
}

export function RevenueArea({
  data,
  currency,
}: {
  data: { month: string; value: number }[];
  currency: string;
}) {
  if (data.every((d) => Number(d.value) === 0)) return <Empty />;
  const rows = data.map((d) => ({ ...d, value: Number(d.value), label: monthLabel(d.month) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.14} />
            <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} />
        <YAxis
          tick={TICK}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(v) => compact(v, currency)}
        />
        <Tooltip
          {...TIP}
          formatter={(v) => full(Number(v), currency)}
          labelFormatter={(l) => String(l)}
        />
        <Area
          isAnimationActive={false}
          type="monotone"
          dataKey="value"
          name="Revenue"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#rev)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Segmented horizontal bar (one segment per stage) with a stage / count grid underneath. */
export function PipelineBar({ data }: { data: { stage: string; value: number }[] }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  if (total === 0) return <Empty />;
  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <div className="flex h-3 gap-[3px]" role="img" aria-label="Enquiry conversion by stage">
        {data.map((d, i) =>
          d.value > 0 ? (
            <span
              key={d.stage}
              className="rounded-full"
              style={{ flex: d.value, background: C[i % C.length], minWidth: 6 }}
            />
          ) : null,
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        {data.map((d, i) => (
          <div key={d.stage} className="flex min-w-0 flex-col">
            <dt className="text-muted-foreground flex items-center gap-1.5 truncate">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ background: C[i % C.length] }}
              />
              {d.stage}
            </dt>
            <dd className="text-sm font-semibold tabular-nums">{d.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function FunnelBars({ data }: { data: { stage: string; value: number }[] }) {
  if (data.every((d) => d.value === 0)) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="stage"
          tick={TICK}
          tickLine={false}
          axisLine={false}
          width={78}
        />
        <Tooltip {...TIP} />
        <Bar
          isAnimationActive={false}
          dataKey="value"
          name="Count"
          radius={[0, 4, 4, 0]}
          label={{ position: "right", fontSize: 11, fill: "var(--muted-foreground)" }}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={C[i % C.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StatusDonut({ data }: { data: { name: string; value: number }[] }) {
  if (data.length === 0) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          isAnimationActive={false}
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="52%"
          outerRadius="82%"
          paddingAngle={data.length > 1 ? 2 : 0}
          startAngle={90}
          endAngle={data.length > 1 ? -270 : -269.9}
          stroke="none"
        >
          {data.map((_, i) => (
            <Cell key={i} fill={C[i % C.length]} />
          ))}
        </Pie>
        <Tooltip {...TIP} />
        <Legend verticalAlign="bottom" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function HorizontalBars({
  data,
  currency,
  color = "var(--chart-2)",
  money = true,
}: {
  data: { name: string; value: number }[];
  currency: string;
  color?: string;
  money?: boolean;
}) {
  if (data.length === 0 || data.every((d) => Number(d.value) === 0)) return <Empty />;
  const rows = data.map((d) => ({ ...d, value: Number(d.value) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          tick={TICK}
          tickLine={false}
          axisLine={false}
          width={86}
        />
        <Tooltip {...TIP} formatter={(v) => (money ? full(Number(v), currency) : String(v))} />
        <Bar
          isAnimationActive={false}
          dataKey="value"
          name={money ? "Revenue" : "Bookings"}
          fill={color}
          radius={[0, 4, 4, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CollectionBars({
  data,
  currency,
}: {
  data: { month: string; collected: number; outstanding: number }[];
  currency: string;
}) {
  if (data.every((d) => Number(d.collected) === 0 && Number(d.outstanding) === 0)) return <Empty />;
  const rows = data.map((d) => ({
    label: monthLabel(d.month),
    collected: Number(d.collected),
    outstanding: Number(d.outstanding),
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} />
        <YAxis
          tick={TICK}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(v) => compact(v, currency)}
        />
        <Tooltip {...TIP} formatter={(v) => full(Number(v), currency)} />
        <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Bar
          isAnimationActive={false}
          dataKey="collected"
          name="Collected"
          stackId="a"
          fill="var(--chart-2)"
        />
        <Bar
          isAnimationActive={false}
          dataKey="outstanding"
          name="Outstanding"
          stackId="a"
          fill="var(--chart-3)"
          radius={[3, 3, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
