// Ícones em SVG (traço de 1,8), os mesmos da prévia.
const P: Record<string, string> = {
  flame:
    '<path d="M12 2.6c.7 3 4.6 5.1 4.6 9.9a4.6 4.6 0 0 1-9.2 0c0-2.1 1-3.5 2.3-4.6.1 1.9.9 3 2 3.4-.5-2.9 0-5.9.3-8.7z" fill="currentColor" stroke="none"/><path d="M12 21.4a3.2 3.2 0 0 1-3.2-3.2c0-1.4.9-2.5 1.9-3.2.2 1.1.7 1.7 1.4 1.9.1-1.1.5-2.1 1.3-2.9.6 1.2 1.8 2.3 1.8 4.2a3.2 3.2 0 0 1-3.2 3.2z" fill="currentColor" stroke="none" opacity=".55"/>',
  gauge: '<path d="M3.5 17.5a9 9 0 1 1 17 0"/><path d="m12 13.5 4.2-4.2"/><circle cx="12" cy="13.5" r="1.3" fill="currentColor"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M8 2.8v3.4M16 2.8v3.4M3 10h18"/><path d="M12 13v2.6l1.8 1.2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  chart: '<path d="M4 20V11M10 20V5M16 20v-6M3 20.5h18"/>',
  sliders:
    '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.6A8 8 0 1 1 9.4 4a6.4 6.4 0 0 0 10.6 10.6z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="M7.5 4.8v14.4L19 12z" fill="currentColor"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16.5 6.5l2.5 2.5M14.5 8.5l2 2"/>',
  eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2.2"/><path d="M8.2 11V8a3.8 3.8 0 0 1 7.6 0v3"/>',
  bell: '<path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.6 1.6 3.7 3.7 0 0 1-.5 7.4z"/>',
  tiktok: '<path d="M14 3.2v11.3a3.6 3.6 0 1 1-3.6-3.6"/><path d="M14 3.2c.6 2.6 2.4 4.3 5 4.6"/>',
  instagram:
    '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="3.9"/><circle cx="17.1" cy="6.9" r="1" fill="currentColor" stroke="none"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  window: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18"/><circle cx="6.5" cy="6.5" r=".6" fill="currentColor"/>',
  bolt: '<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
};

export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return (
    <svg
      className={`ic ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: P[name] || '' }}
    />
  );
}

export function PlatformBadge({ platform, size = '' }: { platform: string; size?: 'xs' | '' }) {
  return (
    <span className={`pf ${size} ${platform}`}>
      <Icon name={platform} />
    </span>
  );
}
