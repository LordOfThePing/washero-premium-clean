import type { ReactNode } from "react";

type Props = {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

export function FinanceSection({ title, description, children, className }: Props) {
  return (
    <section className={className}>
      <div className="mb-3">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}
