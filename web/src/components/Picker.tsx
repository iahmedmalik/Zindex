"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui";

export type PickerOption<T extends string> = { value: T; label: string };

/**
 * A dropdown that looks and moves like the store picker: a pill that opens a bottom sheet on a phone and a popover
 * under the pill on a laptop. The sheet is drawn into <body> so it sits above the tab bar (the page content has its
 * own stacking layer). The pill turns maroon while a filter other than the first option is on.
 */
export function Picker<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: PickerOption<T>[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0]!;
  const changed = value !== options[0]!.value;

  useEffect(() => setMounted(true), []);

  const close = useCallback(() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }, []);
  const show = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (r) setPos({ x: Math.min(r.left, window.innerWidth - 276), y: r.bottom + 8 });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    sheet.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open, close]);

  const choose = (v: T) => { onChange(v); setTimeout(close, 120); };

  return (
    <>
      <button ref={trigger} type="button" className={`store-pill pick${changed ? " on" : ""}`} onClick={show} aria-haspopup="dialog" aria-expanded={open}>
        <span className="pick-l">{label}:</span>
        <span>{current.label}</span>
        <Icon name="down" size={16} />
      </button>
      {mounted && createPortal(
        <>
          <div className={`scrim${open ? " open" : ""}`} onClick={close} aria-hidden="true" />
          <div ref={sheet} className={`sheet anchored${open ? " open" : ""}`} style={{ ["--px" as string]: `${pos.x}px`, ["--py" as string]: `${pos.y}px` }} role="dialog" aria-modal={open} aria-label={`Choose ${label.toLowerCase()}`} aria-hidden={!open}>
            <div className="grab" />
            <h3 style={{ padding: "0 8px 4px" }}>{label}</h3>
            {options.map((o) => (
              <button key={o.value || "all"} type="button" className="opt" role="menuitemradio" aria-checked={o.value === value} onClick={() => choose(o.value)} tabIndex={open ? 0 : -1}>
                {o.label}<span className="check"><Icon name="check" /></span>
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
