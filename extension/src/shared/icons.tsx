// инлайновые SVG вместо эмодзи: те не наследуют цвет и разные в каждой ОС
import type { SVGProps } from 'react';
import type { ReviewTag } from './types.js';

type IconProps = { size?: number } & Omit<SVGProps<SVGSVGElement>, 'width' | 'height'>;

function Svg({ size = 16, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconShield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l7 3v5.5c0 4.3-2.9 8.2-7 9.5-4.1-1.3-7-5.2-7-9.5V6l7-3z" />
    <path d="M9.2 11.8l2 2 3.6-3.9" />
  </Svg>
);

// повторяет иконку расширения из gen-icons.mjs
// цвета зашиты: знак должен узнаваться рядом с иконкой в тулбаре в любой теме
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      <rect width="24" height="24" fill="#14171F" />
      <path
        d="M5.5 4.3 L18.5 4.3 L18.5 13.4 Q18.5 20.2 12 20.2 Q5.5 20.2 5.5 13.4 Z"
        fill="#F0B90B"
      />
      <rect x="8.9" y="10.5" width="6.2" height="3.4" fill="#14171F" />
    </svg>
  );
}

export const IconUser = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8.5" r="3.6" />
    <path d="M4.8 20a7.4 7.4 0 0 1 14.4 0" />
  </Svg>
);

export const IconUsers = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9.5" cy="8.5" r="3.2" />
    <path d="M3.6 19.5a6 6 0 0 1 11.8 0" />
    <path d="M16.4 6.1a3.2 3.2 0 0 1 0 5.6M17.6 14.4a6 6 0 0 1 3 4.2" />
  </Svg>
);

export const IconRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 11.5A8 8 0 1 0 18.4 16" />
    <path d="M20 5.5v5h-5" />
  </Svg>
);

export const IconMinimize = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconPencil = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z" />
    <path d="M14.5 6.5l3 3" />
  </Svg>
);

export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 7h15M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
    <path d="M6.5 7l.9 12.1A1.5 1.5 0 0 0 8.9 20.5h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
  </Svg>
);

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10.8" cy="10.8" r="6.3" />
    <path d="M15.4 15.4L20 20" />
  </Svg>
);

export const IconCopy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 5.5h-9a2 2 0 0 0-2 2v9" />
  </Svg>
);

export const IconInfo = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 8h.01" />
  </Svg>
);

export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4.5l8.5 15h-17l8.5-15z" />
    <path d="M12 10v4M12 17.2v.1" />
  </Svg>
);

export const IconBan = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M6.4 6.4l11.2 11.2" />
  </Svg>
);

export const IconThumbUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 10.5v9H4.8a.8.8 0 0 1-.8-.8v-7.4a.8.8 0 0 1 .8-.8H7z" />
    <path d="M7 10.5l4-6.2a2 2 0 0 1 3.7 1.3l-.6 3.4h4.2a1.9 1.9 0 0 1 1.9 2.3l-1.2 6a2 2 0 0 1-2 1.6H7" />
  </Svg>
);

export const IconThumbDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 13.5v-9H4.8a.8.8 0 0 0-.8.8v7.4a.8.8 0 0 0 .8.8H7z" />
    <path d="M7 13.5l4 6.2a2 2 0 0 0 3.7-1.3l-.6-3.4h4.2a1.9 1.9 0 0 0 1.9-2.3l-1.2-6a2 2 0 0 0-2-1.6H7" />
  </Svg>
);

export const IconStar = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4.5l2.3 4.8 5.2.7-3.8 3.7.9 5.2-4.6-2.5-4.6 2.5.9-5.2L4.5 10l5.2-.7L12 4.5z" />
  </Svg>
);

export const IconClock = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 7.5V12l3 1.8" />
  </Svg>
);

export const IconCard = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="6" width="18" height="12" rx="2.4" />
    <path d="M3 10.2h18" />
  </Svg>
);

export const IconPhone = (p: IconProps) => (
  <Svg {...p}>
    <rect x="7" y="3" width="10" height="18" rx="2.4" />
    <path d="M11 18h2" />
  </Svg>
);

export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19 12a7 7 0 0 0-.1-1.2l1.8-1.3-1.8-3.1-2.1.8a7 7 0 0 0-2.1-1.2L14.4 4h-3.6l-.3 2a7 7 0 0 0-2.1 1.2l-2.1-.8-1.8 3.1 1.8 1.3a7 7 0 0 0 0 2.4l-1.8 1.3 1.8 3.1 2.1-.8a7 7 0 0 0 2.1 1.2l.3 2h3.6l.3-2a7 7 0 0 0 2.1-1.2l2.1.8 1.8-3.1-1.8-1.3c.06-.4.1-.8.1-1.2z" />
  </Svg>
);

export const IconLogout = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 7.5V5.6A1.6 1.6 0 0 0 12.9 4H5.6A1.6 1.6 0 0 0 4 5.6v12.8A1.6 1.6 0 0 0 5.6 20h7.3a1.6 1.6 0 0 0 1.6-1.6v-1.9" />
    <path d="M9.5 12H20M16.8 8.8L20 12l-3.2 3.2" />
  </Svg>
);

export const IconNote = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3.5h8.5L19 8v12.5H6z" />
    <path d="M14 3.5V8.5H19M9 12.5h6M9 16h4" />
  </Svg>
);

export const IconChevron = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 5.5l6.5 6.5L9 18.5" />
  </Svg>
);

export const IconSun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
  </Svg>
);

export const IconMoon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.5 8.5 0 1 0 20 14.2z" />
  </Svg>
);

export const IconTelegram = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20.5 4.7L2.8 11.3l4.9 1.6 1.9 5.6 2.6-3 4.4 3.3z" />
    <path d="M7.7 12.9l9.5-5.7-6.5 7" />
  </Svg>
);

export const IconArrowLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 12H5M10.5 6.5L5 12l5.5 5.5" />
  </Svg>
);

// мошенник
const IconMask = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 8.5c3-1 5.5-1.4 8.5-1.4s5.5.4 8.5 1.4c0 5.6-2.4 9-4.8 9-1.5 0-2.2-1.2-3.7-1.2s-2.2 1.2-3.7 1.2c-2.4 0-4.8-3.4-4.8-9z" />
    <path d="M8 11.6h1.6M14.4 11.6H16" />
  </Svg>
);

// мороз
const IconSnow = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" />
    <path d="M9.4 4.8L12 7.4l2.6-2.6M9.4 19.2L12 16.6l2.6 2.6" />
  </Svg>
);

// грязь
const IconDrop = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5s5.5 6 5.5 9.6a5.5 5.5 0 0 1-11 0C6.5 9.5 12 3.5 12 3.5z" />
  </Svg>
);

// невыполнение условий
const IconTerms = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3.5h8.5L19 8v12.5H6z" />
    <path d="M14 3.5V8.5H19" />
    <path d="M9.4 13.2l4.4 4.4M13.8 13.2l-4.4 4.4" />
  </Svg>
);

// художник
const IconBrush = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15.5 4.5l4 4-7.6 7.6-4-4z" />
    <path d="M7.9 12.1L5 15c-1 1-1 3.5-1.5 4.5 1-.5 3.5-.5 4.5-1.5l2.9-2.9" />
  </Svg>
);

// неадекват
const IconRude = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5.5h16v10H12l-5 4v-4H4z" />
    <path d="M12 8v3.2M12 13.4v.1" />
  </Svg>
);

// комментарий
const IconComment = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5.5h16v10H12l-5 4v-4H4z" />
  </Svg>
);

export const TAG_ICON: Record<ReviewTag, (p: IconProps) => JSX.Element> = {
  SCAM: IconMask,
  FREEZE: IconSnow,
  DIRTY: IconDrop,
  TERMS: IconTerms,
  PAINTER: IconBrush,
  RUDE: IconRude,
  COMMENT: IconComment,
};
