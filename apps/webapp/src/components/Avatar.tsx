/** Muted, theme-safe hues; chosen by user id so a person keeps their color. */
const HUES = [212, 152, 32, 340, 268, 188, 12, 96];

export function initials(firstName: string, lastName?: string | null): string {
  const a = firstName.trim().charAt(0);
  const b = lastName?.trim().charAt(0) ?? '';
  return (a + b).toUpperCase();
}

export function Avatar({
  id,
  firstName,
  lastName,
  size = 40,
  photoUrl,
}: {
  id: number;
  firstName: string;
  lastName?: string | null;
  size?: number;
  /** The person's profile photo; without it, their initials. */
  photoUrl?: string | null;
}) {
  const hue = HUES[Math.abs(id) % HUES.length]!;
  if (photoUrl)
    return (
      <img
        src={photoUrl}
        alt=""
        className="shrink-0 select-none rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `hsl(${hue} 55% 50% / 0.18)`,
        color: `hsl(${hue} 60% var(--avatar-l))`,
      }}
    >
      {initials(firstName, lastName)}
    </span>
  );
}
