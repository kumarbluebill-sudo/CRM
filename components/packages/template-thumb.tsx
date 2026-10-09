import type { Motif, TemplateDef } from "@/lib/packages/templates";
import { readableOn } from "@/lib/packages/templates";

/** Small original vector marks, one per template theme. Drawn here; not taken from any third party. */
function MotifShape({ motif, color }: { motif: Motif; color: string }) {
  const p = {
    fill: "none",
    stroke: color,
    strokeWidth: 2.2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  } as const;
  switch (motif) {
    case "gem":
      return <path {...p} d="M-9 -3 L-5 -9 H5 L9 -3 L0 9 Z M-9 -3 H9 M-3 -3 L0 9 L3 -3" />;
    case "heart":
      return (
        <path
          {...p}
          d="M0 9 C-12 0 -9 -9 -3 -7 C-1 -6.5 0 -5 0 -5 C0 -5 1 -6.5 3 -7 C9 -9 12 0 0 9 Z"
        />
      );
    case "family":
      return (
        <g {...p}>
          <circle cx="-5" cy="-6" r="2.5" />
          <circle cx="5" cy="-6" r="2.5" />
          <circle cx="0" cy="0" r="2" />
          <path d="M-8 8 V0 M8 8 V0 M0 8 V3" />
        </g>
      );
    case "peak":
      return <path {...p} d="M-11 9 L-3 -6 L1 1 L4 -3 L11 9 Z" />;
    case "temple":
      return <path {...p} d="M-9 9 H9 M-6 9 V0 M6 9 V0 M-9 0 H9 L0 -9 Z M0 -9 V-12" />;
    case "group":
      return (
        <g {...p}>
          <circle cx="-6" cy="-4" r="2.2" />
          <circle cx="0" cy="-6" r="2.2" />
          <circle cx="6" cy="-4" r="2.2" />
          <path d="M-9 8 V2 M-3 8 V0 M3 8 V0 M9 8 V2" />
        </g>
      );
    case "globe":
      return (
        <g {...p}>
          <circle cx="0" cy="0" r="9" />
          <path d="M-9 0 H9 M0 -9 C-6 -4 -6 4 0 9 M0 -9 C6 -4 6 4 0 9" />
        </g>
      );
    case "map":
      return <path {...p} d="M-9 -7 L-3 -9 L3 -7 L9 -9 V7 L3 9 L-3 7 L-9 9 Z M-3 -9 V7 M3 -7 V9" />;
    case "wave":
      return (
        <path {...p} d="M-11 -2 C-8 -6 -5 -6 -2 -2 S4 2 7 -2 M-11 5 C-8 1 -5 1 -2 5 S4 9 7 5" />
      );
    case "leaf":
      return <path {...p} d="M-8 8 C-8 -4 0 -9 9 -9 C9 0 4 8 -8 8 Z M-8 8 L3 -3" />;
    case "briefcase":
      return <path {...p} d="M-10 -4 H10 V8 H-10 Z M-4 -4 V-8 H4 V-4 M-10 2 H10" />;
    case "sun":
    default:
      return (
        <g {...p}>
          <circle cx="0" cy="0" r="4" />
          <path d="M0 -10 V-7 M0 7 V10 M-10 0 H-7 M7 0 H10 M-7 -7 L-5 -5 M5 5 L7 7 M-7 7 L-5 5 M5 -5 L7 -7" />
        </g>
      );
  }
}

/** A 4:3 preview card that mirrors the real layout family and palette of the template. */
export function TemplateThumb({ t, className }: { t: TemplateDef; className?: string }) {
  const { primary, secondary, accent, layout } = t.theme;
  const onPrimary = readableOn(primary);
  const id = `grad-${t.key}`;
  return (
    <svg
      viewBox="0 0 160 120"
      role="img"
      aria-label={`${t.name} layout preview`}
      className={className}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={secondary} />
          <stop offset="1" stopColor={primary} />
        </linearGradient>
      </defs>
      <rect width="160" height="120" fill="#ffffff" />
      {layout === "MAGAZINE" && (
        <>
          <rect width="160" height="70" fill={`url(#${id})`} />
          <rect y="44" width="160" height="26" fill={primary} opacity="0.55" />
          <rect x="10" y="50" width="70" height="6" rx="2" fill="#fff" />
          <rect x="10" y="60" width="44" height="4" rx="2" fill="#fff" opacity="0.8" />
          <rect x="10" y="80" width="140" height="4" rx="2" fill="#d1d5db" />
          <rect x="10" y="89" width="120" height="4" rx="2" fill="#e5e7eb" />
          <rect x="10" y="98" width="60" height="10" rx="3" fill={accent} />
        </>
      )}
      {layout === "MODERN" && (
        <>
          <rect width="14" height="120" fill={primary} />
          <rect x="24" y="12" width="90" height="8" rx="2" fill={primary} />
          <rect x="24" y="25" width="60" height="5" rx="2" fill={secondary} />
          <rect x="24" y="40" width="126" height="34" rx="4" fill={`url(#${id})`} opacity="0.9" />
          <rect x="24" y="82" width="126" height="4" rx="2" fill="#d1d5db" />
          <rect x="24" y="91" width="100" height="4" rx="2" fill="#e5e7eb" />
          <rect x="24" y="102" width="44" height="9" rx="3" fill={accent} />
        </>
      )}
      {layout === "CLASSIC" && (
        <>
          <rect
            x="6"
            y="6"
            width="148"
            height="108"
            fill="none"
            stroke={secondary}
            strokeWidth="1"
          />
          <rect x="10" y="10" width="140" height="44" fill={primary} />
          <rect x="45" y="22" width="70" height="6" rx="2" fill={onPrimary} />
          <rect x="58" y="33" width="44" height="4" rx="2" fill={accent} />
          <rect x="22" y="64" width="116" height="4" rx="2" fill="#d1d5db" />
          <rect x="22" y="73" width="96" height="4" rx="2" fill="#e5e7eb" />
          <rect x="22" y="82" width="106" height="4" rx="2" fill="#e5e7eb" />
          <rect x="52" y="96" width="56" height="9" rx="3" fill={secondary} />
        </>
      )}
      <g
        transform={
          layout === "CLASSIC"
            ? "translate(80 43) scale(1.1)"
            : layout === "MAGAZINE"
              ? "translate(138 22) scale(1.4)"
              : "translate(137 57) scale(1.5)"
        }
      >
        <MotifShape motif={t.motif} color={layout === "CLASSIC" ? accent : "#ffffff"} />
      </g>
    </svg>
  );
}
