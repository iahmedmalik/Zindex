import { forCustomer, offLabel, pkr, stageLabel } from "@/lib/format";
import type { Order, Store } from "@/lib/types";

const n = (x: number) => x.toLocaleString("en-US");

/**
 * The Receipt: an order as a till slip. The stage is shown as a status chip; changing the stage
 * remounts the chip (the key), which plays the arrival again. It carries the store's own email, phone and
 * address (set in the store's details), so what the owner sees is what a customer gets.
 */
export function Receipt({ order: placed, store }: { order: Order; store?: Store }) {
  const order = forCustomer(placed); // delivery the store pays is not on the customer's slip
  const contact = [store?.email, store?.phone].filter(Boolean).join(" · ");
  return (
    <div className="slip" role="group" aria-label={`Receipt for order ${order.orderNo}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {store?.logoUrl && <img className="slip-logo" src={store.logoUrl} alt="" />}
      <h4>{(store?.name ?? "Order").toUpperCase()}</h4>
      {contact && <div className="mut">{contact}</div>}
      <div className="mut">Order #{order.orderNo} · {new Date(order.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
      <div style={{ height: 8 }} />
      {order.items.map((i) => (
        <div key={i.id} className="ln">
          <span>{i.name} × {i.quantity}{i.discountKind && i.discountValue ? ` · ${offLabel({ kind: i.discountKind, value: i.discountValue })}` : ""}</span>
          <span className="num">{i.discountAmount > 0 && <s>{n(i.quantity * i.unitPrice)}</s>}{n(i.quantity * i.unitPrice - i.discountAmount)}</span>
        </div>
      ))}
      {order.discount > 0 && <div className="ln"><span>Discount {order.discountPercent}%</span><span className="num">− {n(order.discount)}</span></div>}
      {order.deliveryCharge > 0 && <div className="ln"><span>Delivery fee</span><span className="num">{n(order.deliveryCharge)}</span></div>}
      <div className="ln tot"><span>TOTAL</span><span className="num">{n(order.total)}</span></div>
      {order.riderFee > 0 && <div className="ln"><span>Rider fee (to the rider)</span><span className="num">+ {n(order.riderFee)}</span></div>}
      {order.collectAtDoor > 0 && <div className="ln tot" style={{ borderTopStyle: "solid" }}><span>AT THE DOOR</span><span className="num">{pkr(order.collectAtDoor)}</span></div>}
      {store?.address && <div className="ln mut contact"><span>{store.address}</span></div>}
      <span key={order.status} className="slipchip"><i />{stageLabel[order.status]}</span>
    </div>
  );
}
