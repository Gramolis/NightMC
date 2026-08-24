/** Zestaw ikon SVG (bez zewnętrznych bibliotek, bez zdalnych zasobów). */

interface P {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const IconHome = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>
);
export const IconGrid = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}><rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" /></svg>
);
export const IconPlus = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconLayers = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></svg>
);
export const IconPuzzle = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}><path d="M10 3h4v2.5a2 2 0 1 0 4 0V8h3v4h-2.5a2 2 0 1 0 0 4H21v5h-5v-2.5a2 2 0 1 0-4 0V21H7v-5H4.5a2 2 0 1 1 0-4H7V8h3V3Z" /></svg>
);
export const IconPackage = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="m3 8 9 5 9-5M12 13v8" /></svg>
);
export const IconServer = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}><rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 7h.01M7 17h.01" /></svg>
);
export const IconUser = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" /></svg>
);
export const IconCpu = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></svg>
);
export const IconSettings = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V1a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 17 2.6a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H23a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" transform="translate(0.6 0.6) scale(0.92)" /></svg>
);
export const IconTerminal = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></svg>
);
export const IconInfo = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}><circle cx="12" cy="12" r="9" /><path d="M12 16v-5M12 8h.01" /></svg>
);
export const IconPlay = ({ size = 22, className }: P) => (
  <svg {...base(size)} className={className} fill="currentColor" stroke="none"><path d="M7 4.5v15l13-7.5-13-7.5Z" /></svg>
);
export const IconStop = ({ size = 22, className }: P) => (
  <svg {...base(size)} className={className} fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
);
export const IconRefresh = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></svg>
);
export const IconTrash = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13" /></svg>
);
export const IconFolder = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></svg>
);
export const IconDownload = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}><path d="M12 3v12M7 11l5 5 5-5M4 20h16" /></svg>
);
export const IconSearch = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
export const IconCheck = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}><path d="m4 12.5 5.5 5.5L20 6.5" /></svg>
);
export const IconCopy = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>
);
export const IconWarn = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}><path d="M10.3 3.7 2.5 17a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>
);
export const IconMoon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" /></svg>
);
export const IconEdit = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}><path d="M4 20h4L20 8l-4-4L4 16v4Z" /></svg>
);
export const IconPower = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}><path d="M12 3v9" /><path d="M6.5 6.8a8 8 0 1 0 11 0" /></svg>
);
