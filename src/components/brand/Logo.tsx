import { Link } from "@tanstack/react-router";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`inline-flex items-center gap-1 font-bold tracking-tight ${className}`}>
      <span className="text-xl">Washero</span>
      <span className="inline-block h-2 w-2 rounded-full bg-primary" aria-hidden />
    </Link>
  );
}
