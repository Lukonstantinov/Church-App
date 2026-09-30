import { patternBackground, type PatternConfig } from '@church/shared';

/**
 * A ministry's icon repeated over its colours. The layer is larger than its parent and
 * rotated, so a tilted pattern still covers the corners. Parent: relative + overflow-hidden.
 */
export function PatternLayer({
  pattern,
  logoUrl,
}: {
  pattern: PatternConfig | null | undefined;
  logoUrl?: string | null;
}) {
  if (!pattern) return null;
  const bg = patternBackground(pattern, logoUrl);
  if (!bg) return null;
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <span
        className="absolute left-1/2 top-1/2"
        style={{
          width: '260%',
          height: '260%',
          transform: `translate(-50%, -50%) rotate(${pattern.angle}deg)`,
          backgroundImage: bg.image,
          backgroundSize: `${bg.size} ${bg.size}`,
          backgroundRepeat: 'repeat',
          backgroundPosition: 'center',
          opacity: pattern.opacity,
        }}
      />
    </span>
  );
}
