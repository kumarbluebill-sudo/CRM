"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type ComboOption = { value: string; label: string };

type Props = {
  name: string;
  options: ComboOption[];
  defaultValue?: string | null;
  required?: boolean;
  placeholder?: string;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  className?: string;
  onChange?: (value: string) => void;
};

const MAX_SHOWN = 60;

/**
 * Searchable select. The chosen value travels in a hidden input, so it works inside ordinary server-action forms.
 * Keyboard: type to filter, Up/Down to move, Enter to choose, Escape to close.
 */
export function Combobox({
  name,
  options,
  defaultValue,
  required,
  placeholder = "Search…",
  id,
  className,
  onChange,
  ...aria
}: Props) {
  const auto = useId();
  const listId = `${id ?? auto}-list`;
  const [value, setValue] = useState(defaultValue ?? "");
  const selected = options.find((o) => o.value === value);
  const [text, setText] = useState(selected?.label ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => {
    const q = text.trim().toLowerCase();
    const filtered =
      !q || (selected && q === selected.label.toLowerCase())
        ? options
        : options.filter((o) => o.label.toLowerCase().includes(q));
    return filtered.slice(0, MAX_SHOWN);
  }, [options, text, selected]);

  function choose(v: string) {
    const o = options.find((x) => x.value === v);
    setValue(v);
    setText(o?.label ?? "");
    setOpen(false);
    onChange?.(v);
  }

  return (
    <div className={cn("relative", className)}>
      <input type="hidden" name={name} value={value} />
      <input
        ref={input}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
        aria-required={required || undefined}
        {...aria}
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // let a click on an option register first
          setTimeout(() => {
            setOpen(false);
            setText(options.find((o) => o.value === value)?.label ?? "");
          }, 120);
        }}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
          if (e.target.value === "" && !required) {
            setValue("");
            onChange?.("");
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, shown.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && shown[active]) {
            e.preventDefault();
            choose(shown[active].value);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="border-input bg-background focus-visible:ring-ring/50 focus-visible:border-ring h-8 w-full rounded-lg border px-2.5 pr-8 text-sm outline-none focus-visible:ring-3 aria-invalid:border-tone-bad/30"
      />
      <ChevronsUpDown
        className="text-muted-foreground pointer-events-none absolute top-2 right-2.5 size-4"
        aria-hidden
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="bg-popover text-popover-foreground absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border p-1 text-sm shadow-md"
        >
          {shown.length === 0 && <li className="text-muted-foreground px-2 py-1.5">No matches</li>}
          {shown.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(o.value);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5",
                i === active && "bg-muted",
              )}
            >
              <Check
                className={cn("size-3.5", o.value === value ? "opacity-100" : "opacity-0")}
                aria-hidden
              />
              <span className="truncate">{o.label}</span>
            </li>
          ))}
          {!required && value && (
            <li
              role="option"
              aria-selected={false}
              onMouseDown={(e) => {
                e.preventDefault();
                choose("");
              }}
              className="text-muted-foreground hover:bg-muted cursor-pointer rounded-md px-2 py-1.5"
            >
              Clear selection
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
