"use client";
import { useEffect, useId, useRef, useState } from "react";

type Option = { value: string; label: string };
export function Select({
  label,
  value,
  options,
  onChange,
  disabled = false,
  searchable = false,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
  searchable?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const filtered = options.filter((option) =>
    option.label.toLowerCase().includes(search.toLowerCase()),
  );
  const selected = options.findIndex((option) => option.value === value);
  const show = () => {
    setSearch("");
    setActive(Math.max(0, selected));
    setOpen(true);
  };
  const choose = (index: number) => {
    if (filtered[index]) onChange(filtered[index].value);
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (open && searchable) searchInput.current?.focus();
  }, [open, searchable]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (open)
      root.current
        ?.querySelector(`[id="${CSS.escape(id)}-option-${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);
  return (
    <div
      className="select"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="select-trigger"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${id}-option-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            if (!open) {
              show();
              return;
            }
            if (!filtered.length) return;
            setActive((index) =>
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? filtered.length - 1
                  : (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      filtered.length) %
                    filtered.length,
            );
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) choose(active);
            else show();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          } else if (event.key === "Tab") setOpen(false);
          else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
            const index = filtered.findIndex((option) =>
              option.label.toLowerCase().startsWith(event.key.toLowerCase()),
            );
            if (index >= 0) {
              event.preventDefault();
              setActive(index);
              setOpen(true);
            }
          }
        }}
      >
        <span>{options[selected]?.label || label}</span>
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
        >
          <path
            d="m4 6 4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div
          id={`${id}-list`}
          className="select-menu"
          role="listbox"
          aria-label={label}
        >
          {searchable && (
            <input
              ref={searchInput}
              type="search"
              aria-label={`${label} 검색 / Search`}
              className="select-search"
              value={search}
              placeholder="Asia/Seoul, UTC…"
              onChange={(e) => {
                setSearch(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setOpen(false);
                  trigger.current?.focus();
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive(0);
                  trigger.current?.focus();
                } else if (e.key === "Enter" && filtered.length) {
                  e.preventDefault();
                  choose(active);
                }
              }}
            />
          )}
          {filtered.map((option, index) => (
            <div
              id={`${id}-option-${index}`}
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={`select-option ${index === active ? "active" : ""}`}
              onPointerMove={() => setActive(index)}
              onPointerDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.preventDefault();
                choose(index);
              }}
            >
              <span>{option.label}</span>
              <span aria-hidden="true">
                {option.value === value ? "✓" : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
