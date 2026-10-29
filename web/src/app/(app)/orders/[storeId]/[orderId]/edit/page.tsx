"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { OrderForm } from "@/components/order-form";
import { api, messageOf } from "@/lib/api";
import type { Order } from "@/lib/types";

// The same form as New order, filled in with the order's own details. The status does not change.
export default function EditOrderPage() {
  const { storeId, orderId } = useParams<{ storeId: string; orderId: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ order: Order }>(`/stores/${storeId}/orders/${orderId}`).then((r) => setOrder(r.order)).catch((e) => setError(messageOf(e)));
  }, [storeId, orderId]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!order) return <div className="skel" aria-busy="true"><span /><span /><span /></div>;
  if (order.status === "cancelled" || order.status === "returned") {
    return (
      <div className="empty"><b>This order is {order.status}</b><span>A {order.status} order cannot be edited. Delete it, or make a new order.</span>
        <Link className="btn quiet" href={`/orders/${storeId}/${orderId}`}>Back to the order</Link>
      </div>
    );
  }
  return <OrderForm edit={order} />;
}
