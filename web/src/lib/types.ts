// The shapes the API returns (see api/src/routes). Only what the screens use.

export type Store = { id: string; name: string; phone: string | null; email: string | null; address: string | null; logoUrl: string | null; accent: string; invoicePrefix: string };

export type Stage = "pending" | "confirmed" | "packed" | "out_for_delivery" | "delivered" | "returned" | "cancelled";
export type Payment = "paid" | "cod" | "unpaid";
export type DeliveryKind = "local" | "courier" | "pickup";

export type OrderItem = { id: string; productId: string | null; name: string; quantity: number; unitPrice: number; unitCost: number | null };

export type Order = {
  id: string;
  storeId: string;
  orderNo: number;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  address: string | null;
  status: Stage;
  deliveryKind: DeliveryKind;
  payment: Payment;
  paymentMethod: string | null;
  discountPercent: number;
  deliveryCharge: number;
  riderFee: number;
  subtotal: number;
  discount: number;
  total: number;
  codAmount: number;
  collectAtDoor: number;
  amountDue: number;
  notes: string | null;
  stockApplied: boolean;
  paymentConfirmedAt: string | null;
  externalRef: string | null;
  createdAt: string;
  items: OrderItem[];
};

export type Product = { id: string; name: string; price: number; cost: number | null; active: boolean };
export type StockRow = { productId: string; name: string; price: number; cost: number | null; onHand: number; unitsSold: number };
export type Customer = { id: string; name: string; phone: string; addresses: string[]; notes: string | null; orderCount?: number };

export type Delivery = {
  id: string;
  service: "indrive" | "yango" | null;
  riderName: string | null;
  riderPhone: string | null;
  bikeNumber: string | null;
  riderPhotoUrl: string | null;
  hasPhoto: boolean;
  trackingUrl: string | null;
  riderScreenshotUrl: string | null;
  pickupAddress: string | null;
  notes: string | null;
};

export type Board = {
  stores: (BoardCounts & { storeId: string; name: string; accent: string })[];
  totals: BoardCounts;
};
export type BoardCounts = {
  pending: number;
  toPack: number;
  awaitingRider: number;
  outForDelivery: number;
  delivered: number;
  problems: number;
  cashOutstanding: number;
  needsAction: number;
  ordersToday: number;
  salesToday: number;
};

export type Invoice = { id: string; status: "draft" | "final"; number: string | null; finalisedAt: string | null };
