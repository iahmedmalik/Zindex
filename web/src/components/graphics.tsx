// Small moving graphics. Each one is plain SVG moved by CSS keyframes (no canvas, no 3D), so it stays
// cheap on a phone. The motion rules live in globals.css; reduced motion stops them all.

/** The road on Today: the van keeps driving to the house while the day's sales are shown above it. */
export function Road() {
  return (
    <svg className="road" viewBox="0 0 375 74" preserveAspectRatio="none" aria-hidden="true">
      <g className="g-cloud"><ellipse cx="40" cy="14" rx="22" ry="7" fill="#fff" opacity=".12" /></g>
      <g className="g-cloud" style={{ animationDelay: "-7s" }}><ellipse cx="40" cy="26" rx="16" ry="5" fill="#fff" opacity=".1" /></g>
      <g className="g-house"><rect x="300" y="26" width="30" height="34" rx="4" fill="#e9b9bf" /><path d="M296 28l19-14 19 14z" fill="#fff" opacity=".9" /><rect x="310" y="44" width="9" height="16" rx="2" fill="#5d1b23" /></g>
      <rect x="0" y="60" width="375" height="14" fill="#000" opacity=".19" />
      <path className="g-lane" d="M0 67H375" stroke="#fff" strokeWidth="2" strokeDasharray="14 14" opacity=".55" />
      <g className="g-van"><g className="g-drive">
        <rect x="40" y="34" width="46" height="26" rx="6" fill="#fff" />
        <path d="M86 42h16l8 12v6H86z" fill="#e9b9bf" />
        <circle className="g-wheel" cx="56" cy="61" r="7" fill="#16100f" stroke="#fff" strokeWidth="2" />
        <circle className="g-wheel" cx="98" cy="61" r="7" fill="#16100f" stroke="#fff" strokeWidth="2" />
        <path d="M50 42h18M50 49h12" stroke="#5d1b23" strokeWidth="3" strokeLinecap="round" />
      </g></g>
    </svg>
  );
}

/** Delivery-card map: the rider rides along a dotted route to the house. */
export function RouteMap() {
  return (
    <svg className="routemap" viewBox="0 0 345 150" aria-hidden="true">
      <path d="M0 40H345M0 100H345M80 0V150M230 0V150" stroke="#fff" strokeOpacity=".08" strokeWidth="10" />
      <path className="g-route" d="M30 120 C 90 120, 90 50, 160 70 S 260 30, 320 36" stroke="#e9b9bf" strokeWidth="3" fill="none" strokeLinecap="round" />
      <circle className="g-dest" cx="320" cy="36" r="8" fill="#e9b9bf" />
      <circle cx="320" cy="36" r="6" fill="#fff" />
      <g className="g-rider"><circle r="12" fill="#fff" /><circle r="12" fill="none" stroke="#e9b9bf" strokeWidth="3" /><path d="M-5 2l3-6h5l2 6" stroke="#5d1b23" strokeWidth="2" fill="none" strokeLinecap="round" /></g>
    </svg>
  );
}

/** An empty list: a van parked on a dashed road. */
export function EmptyVan() {
  return (
    <svg width="150" height="90" viewBox="0 0 150 90" fill="none" aria-hidden="true">
      <path d="M0 78H150" stroke="var(--line)" strokeWidth="3" strokeDasharray="6 8" />
      <g className="g-van"><rect x="40" y="34" width="44" height="30" rx="5" fill="var(--brand)" /><path d="M84 44H104L112 56V64H84Z" fill="var(--brand)" opacity=".75" /><circle className="g-wheel" cx="56" cy="68" r="8" fill="var(--ink)" /><circle className="g-wheel" cx="100" cy="68" r="8" fill="var(--ink)" /></g>
    </svg>
  );
}

/** The Zindex mark: a Z drawn like packing tape on a parcel. `draw` makes it draw itself once. */
export function Logo({ size = 40, draw = false, tone = "brand" }: { size?: number; draw?: boolean; tone?: "brand" | "paper" }) {
  const tile = tone === "brand" ? "var(--brand)" : "#f1ede8";
  const ink = tone === "brand" ? "#f1ede8" : "#5d1b23";
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <rect x="6" y="6" width="108" height="108" rx="30" fill={tile} />
      <path className={draw ? "g-draw" : undefined} d="M34 38 H86 L34 82 H86" stroke={ink} strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M60 6 V20 M60 100 V114" stroke={ink} strokeWidth="3" strokeDasharray="2 5" strokeLinecap="round" opacity=".5" />
    </svg>
  );
}
