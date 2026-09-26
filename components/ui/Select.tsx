"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

/* ----------------------------------------------------------------------------
   Select — an accessible listbox that replaces the native <select>.

   A native control cannot be styled once it opens: the menu is drawn by the OS,
   in the system font, with the system highlight. This renders the menu itself so
   it belongs to the VIP Realty language on both surfaces.

   Behaviour follows the WAI-ARIA listbox pattern:
     trigger   button with aria-haspopup="listbox", aria-expanded, aria-controls,
               labelled by the field label plus its current value
     menu      ul[role="listbox"] of li[role="option"] with aria-selected, and a
               virtual cursor via aria-activedescendant (focus stays on the list)
     keyboard  Enter / Space / ArrowUp / ArrowDown open; arrows move; Home / End
               jump; printable characters type-ahead; Enter commits; Escape and
               Tab close and return focus to the trigger
     pointer   click to open, click an option to commit, pointerdown outside to
               dismiss

   The value is committed through `onChange`, so the surrounding form state and
   URL synchronisation are unchanged from the native version.

   FOCUS ACROSS A REMOUNT
   The properties index is remounted per query string (`key={queryKey}` in
   app/(site)/properties/page.tsx), so committing a value destroys this
   component and builds a new one. Focusing `triggerRef` inside `close()` is
   therefore not enough on that surface: the element it focused is unmounted
   moments later and focus falls back to <body>, dumping a keyboard user at the
   top of the document. React's `useId` is no help as an anchor either — the
   remounted tree generates different ids than the hydrated one.

   So a commit records the caller-supplied `name` in module scope, which is the
   one thing that survives the unmount, and the replacement instance with that
   same name claims focus when it mounts. The token expires quickly, so a commit
   that does NOT cause a remount can never steal focus from a later page.
---------------------------------------------------------------------------- */

export interface SelectOption {
  id: string;
  label: string;
}

/** The select whose replacement instance should take focus, and when it was set. */
let pendingFocus: { name: string; at: number } | null = null;

/** A remount caused by a commit lands well inside this window. */
const FOCUS_HANDOVER_MS = 1500;

export function Select({
  label,
  value,
  options,
  onChange,
  name,
  tone = "dark",
  className = "",
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (id: string) => void;
  /** Stable identity for this field, unchanged across a remount. Without it the
   *  trigger cannot be re-focused after a commit that rebuilds the tree. */
  name: string;
  tone?: "dark" | "light";
  className?: string;
}) {
  const uid = useId();
  const labelId = `${uid}-label`;
  const valueId = `${uid}-value`;
  const listId = `${uid}-list`;
  const optionId = (i: number) => `${uid}-opt-${i}`;

  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((o) => o.id === value));
  const [active, setActive] = useState(selectedIndex);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ term: "", at: 0 });

  const dark = tone === "dark";
  const current = options.find((o) => o.id === value) ?? options[0];

  const close = useCallback((focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  const openAt = useCallback((index: number) => {
    setActive(index);
    setOpen(true);
  }, []);

  const commit = useCallback(
    (index: number) => {
      const option = options[index];
      // Claim the handover BEFORE onChange: onChange may start the transition
      // that unmounts this component.
      pendingFocus = { name, at: Date.now() };
      if (option) onChange(option.id);
      close();
    },
    [options, onChange, close, name],
  );

  // Take focus if this instance replaced one that was just committed. Runs on
  // mount only; the direct focus in `close()` covers the no-remount case.
  useEffect(() => {
    if (!pendingFocus || pendingFocus.name !== name) return;
    const fresh = Date.now() - pendingFocus.at < FOCUS_HANDOVER_MS;
    pendingFocus = null;
    if (fresh) triggerRef.current?.focus();
    // Mount-only by design: a later render must not re-steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move focus into the list so screen readers announce the active option, and
  // keep the active option scrolled into view.
  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // optionId is derived from a stable useId, so it does not need to be a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active, uid]);

  // Dismiss on an outside pointer press. `pointerdown` rather than `click` so the
  // menu closes before the underlying control receives the press.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const typeahead = (key: string) => {
    const now = Date.now();
    typed.current.term = now - typed.current.at > 700 ? key : typed.current.term + key;
    typed.current.at = now;
    const term = typed.current.term.toLowerCase();
    const from = options.findIndex((o, i) => i > active && o.label.toLowerCase().startsWith(term));
    const found = from >= 0 ? from : options.findIndex((o) => o.label.toLowerCase().startsWith(term));
    if (found >= 0) setActive(found);
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
      case "Enter":
      case " ":
        e.preventDefault();
        openAt(selectedIndex);
        break;
      case "Home":
        e.preventDefault();
        openAt(0);
        break;
      case "End":
        e.preventDefault();
        openAt(options.length - 1);
        break;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          openAt(selectedIndex);
          typeahead(e.key);
        }
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(options.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        commit(active);
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "Tab":
        // Let focus leave naturally, but do not leave an orphaned menu behind.
        close(false);
        break;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          typeahead(e.key);
        }
    }
  };

  const t = dark
    ? {
        field: "border-ivory/15 hover:border-champagne/60",
        label: "text-ivory/45",
        value: "text-ivory",
        chevron: "text-champagne",
        panel: "border-ivory/15 bg-ink shadow-[0_18px_40px_-16px_rgb(0_0_0/0.7)]",
        option: "text-ivory/75",
        optionActive: "bg-ivory/10 text-ivory",
        optionSelected: "text-champagne",
        marker: "bg-champagne",
      }
    : {
        field: "border-espresso/15 hover:border-gold/70",
        label: "text-espresso/55",
        value: "text-espresso",
        chevron: "text-gold",
        panel: "border-espresso/15 bg-parchment shadow-card",
        option: "text-espresso/80",
        optionActive: "bg-espresso/8 text-ink",
        optionSelected: "text-ink",
        marker: "bg-gold",
      };

  return (
    <div ref={rootRef} className={`group relative border-t px-1 pb-4 pt-5 transition-colors duration-500 sm:px-2 ${t.field} ${className}`}>
      <span id={labelId} className={`label block ${t.label}`}>{label}</span>

      <button
        ref={triggerRef}
        type="button"
        id={`${uid}-trigger`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${valueId}`}
        onClick={() => (open ? close() : openAt(selectedIndex))}
        onKeyDown={onTriggerKeyDown}
        className="mt-2 flex w-full items-center justify-between gap-3 text-left outline-none focus-visible:ring-1 focus-visible:ring-current"
      >
        <span
          id={valueId}
          className={`font-display text-[1.35rem] leading-tight tracking-tight sm:text-[1.6rem] ${t.value}`}
        >
          {current?.label ?? ""}
        </span>
        <span
          aria-hidden
          className={`shrink-0 text-[0.7rem] transition-transform duration-500 ${t.chevron} ${open ? "rotate-180" : ""}`}
        >
          ▼
        </span>
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={labelId}
          aria-activedescendant={optionId(active)}
          onKeyDown={onListKeyDown}
          className={`absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto border py-1 outline-none ${t.panel}`}
        >
          {options.map((option, i) => {
            const isSelected = option.id === value;
            const isActive = i === active;
            return (
              <li
                key={option.id}
                id={optionId(i)}
                role="option"
                aria-selected={isSelected}
                onClick={() => commit(i)}
                onPointerMove={() => setActive(i)}
                className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 text-[0.95rem] transition-colors duration-200 ${
                  isActive ? t.optionActive : t.option
                } ${isSelected ? t.optionSelected : ""}`}
              >
                <span
                  aria-hidden
                  className={`h-3 w-px shrink-0 transition-opacity duration-200 ${t.marker} ${
                    isSelected ? "opacity-100" : "opacity-0"
                  }`}
                />
                {option.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
