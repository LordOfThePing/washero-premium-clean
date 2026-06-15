import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { BreakdownItem } from "@/lib/finance/types";
import { fmtCurrency, fmtDate } from "@/lib/finance/utils";

type Props = {
  byPaymentMethod: BreakdownItem[];
  byBookingStatus: BreakdownItem[];
  byBookingSource: BreakdownItem[];
  topNeighborhoods: BreakdownItem[];
  topDays: BreakdownItem[];
};

function BreakdownTable({ title, items }: { title: string; items: BreakdownItem[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin datos.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.label} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-muted-foreground">{item.label}</span>
                <span className="shrink-0 font-medium">{fmtCurrency(item.revenue)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const chartConfig = {
  revenue: { label: "Revenue", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;

export function FinanceBreakdown({
  byPaymentMethod,
  byBookingStatus,
  byBookingSource,
  topNeighborhoods,
  topDays,
}: Props) {
  const chartData = byPaymentMethod.map((d) => ({
    name: d.label,
    revenue: d.revenue,
  }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Revenue por método de pago</CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin datos.</p>
            ) : (
              <ChartContainer config={chartConfig} className="h-[220px] w-full">
                <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 8 }}>
                  <CartesianGrid horizontal={false} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={100}
                    tickLine={false}
                    axisLine={false}
                  />
                  <XAxis type="number" hide />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="revenue" fill="var(--color-revenue)" radius={4} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
        <BreakdownTable title="Revenue por estado de reserva" items={byBookingStatus} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <BreakdownTable title="Revenue por origen" items={byBookingSource} />
        <BreakdownTable title="Top barrios / barrios privados" items={topNeighborhoods} />
        <BreakdownTable
          title="Top días por revenue"
          items={topDays.map((d) => ({ ...d, label: fmtDate(d.label) }))}
        />
      </div>
    </div>
  );
}
