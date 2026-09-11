// Shared 24px navigation grid. Wiki uses Tabler book-2 (MIT); see docs/assets/icons/SOURCES.md.
export function NavigationIcon({
  name,
}: {
  name: "wiki" | "sessions" | "jobs" | "settings" | "session-settings" | "docs";
}) {
  return (
    <svg
      className="navigation-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === "wiki" ? (
        // Tabler Icons book-2, MIT: https://github.com/tabler/tabler-icons/blob/v3.34.1/icons/outline/book-2.svg
        <>
          <path d="M19 4v16h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12z" />
          <path d="M19 16h-12a2 2 0 0 0 -2 2" />
          <path d="M9 8h6" />
        </>
      ) : name === "sessions" ? (
        <>
          <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3a2 2 0 0 1-2-2V7" />
          <path d="M7 9h10M7 13h6" />
        </>
      ) : name === "jobs" ? (
        <>
          <path d="M7 3h10a2 2 0 0 1 2 2v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a2 2 0 0 1 2-2Z" />
          <path d="M9 8h6M9 16v-3m3 3v-5m3 5v-2" />
        </>
      ) : name === "docs" ? (
        <>
          <path d="M12 5v15M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Z" />
          <path d="M5 8h4M5 12h4m6-4h4m-4 4h4" />
        </>
      ) : (
        <>
          <path
            d="m9.5 3-.6 2.4-2 .9-2.2-.7-2.5 4.3 1.7 1.7v2.3l-1.7 1.7 2.5 4.3 2.2-.7 2 .9.6 2.4h5l.6-2.4 2-.9 2.2.7 2.5-4.3-1.7-1.7v-2.3l1.7-1.7-2.5-4.3-2.2.7-2-.9-.6-2.4Z"
            transform="translate(0 -1) scale(1 .96)"
          />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}
