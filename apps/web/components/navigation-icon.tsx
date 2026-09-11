// Original Atlas navigation assets. Shared 24px grid and 1.75px stroke.
export function NavigationIcon({
  name,
}: {
  name: "sessions" | "jobs" | "settings";
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
      {name === "sessions" ? (
        <>
          <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3a2 2 0 0 1-2-2V7" />
          <path d="M7 9h10M7 13h6" />
        </>
      ) : name === "jobs" ? (
        <>
          <path d="M7 3h10a2 2 0 0 1 2 2v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a2 2 0 0 1 2-2Z" />
          <path d="M9 8h6M9 16v-3m3 3v-5m3 5v-2" />
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
