// WhatsApp messages are sent from the owner's own phone with a wa.me link: no Business API, no cost.
// Templates are plain English text with {fields} that get filled in from the order.

export const templateKeys = ["order_confirmed", "invoice", "rider_assigned", "on_the_way", "delivered", "payment_reminder", "thank_you", "ready_for_pickup"] as const;
export type TemplateKey = (typeof templateKeys)[number];

export const defaults: Record<TemplateKey, string> = {
  order_confirmed: "Assalam o Alaikum {name}! Your order #{order_no} from {store} is confirmed. Total: PKR {total}. We will message you when it is packed.",
  invoice: "Hi {name}, here is your invoice {invoice_no} from {store} for order #{order_no}. Total: PKR {total}. Thank you!",
  rider_assigned: "Hi {name}, your order #{order_no} is booked with rider {rider_name} ({rider_phone}), bike {bike}. Track it here: {link}",
  on_the_way: "Hi {name}, your order #{order_no} is on its way. Please keep PKR {collect} ready for the rider. Details: {link}",
  delivered: "Hi {name}, your order #{order_no} from {store} has been delivered. We hope you like it!",
  payment_reminder: "Hi {name}, a gentle reminder: PKR {amount_due} is still due for order #{order_no} from {store}. JazzCash / Easypaisa / bank transfer all work. Thank you!",
  ready_for_pickup: "Hi {name}, your order #{order_no} from {store} is ready for pickup. Please have PKR {collect} ready when you collect it. Directions and details: {link}",
  thank_you: "Thank you for ordering from {store}, {name}! We would love to serve you again.",
};

/** Fills {fields}; a field with no value is left out cleanly instead of printing "undefined". */
export function fill(template: string, values: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{([a-z_]+)\}/g, (_, key: string) => String(values[key] ?? "")).replace(/ {2,}/g, " ").trim();
}

/** wa.me wants the number with the country code and no plus: 0300 1234567 becomes 923001234567. */
export function waNumber(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) return "92" + digits.slice(1);
  return digits || null;
}

export const waLink = (phone: string | null, text: string) => {
  const number = waNumber(phone);
  return `https://wa.me/${number ?? ""}?text=${encodeURIComponent(text)}`;
};
