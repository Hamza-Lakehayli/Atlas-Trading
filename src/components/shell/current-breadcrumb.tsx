"use client";

import { usePathname } from "next/navigation";

export function CurrentBreadcrumb({ locale, labels }: {
  locale: string;
  labels: { overview: string; customers: string; orders: string; copilot: string };
}) {
  const pathname = usePathname();
  const route = pathname.startsWith(`/${locale}/sales/customers`) ? labels.customers
    : pathname.startsWith(`/${locale}/sales/orders`) ? labels.orders
      : pathname.startsWith(`/${locale}/copilot`) ? labels.copilot
        : labels.overview;
  return <div className="breadcrumbs"><span>Atlas Trading Co.</span><span className="crumb-slash">/</span><b>{route}</b></div>;
}
