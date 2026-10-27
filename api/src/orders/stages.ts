// The seven order stages and which move is allowed from which. An order only goes forward (or to
// cancelled / returned); going back means making a new order, so history stays honest.

export const stages = ["pending", "confirmed", "packed", "out_for_delivery", "delivered", "returned", "cancelled"] as const;
export type Stage = (typeof stages)[number];

const next: Record<Stage, readonly Stage[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["packed", "cancelled"],
  packed: ["out_for_delivery", "delivered", "cancelled"],
  out_for_delivery: ["delivered", "returned", "cancelled"],
  delivered: ["returned"],
  returned: [],
  cancelled: [],
};

export const canMove = (from: Stage, to: Stage) => next[from].includes(to);
