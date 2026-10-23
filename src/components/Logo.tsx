export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 34 34"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="14" cy="14" r="10" />
      <path d="M21.5 21.5 31 31" />
      <path d="M9 11h10M9 15h10M9 19h6" />
    </svg>
  );
}
