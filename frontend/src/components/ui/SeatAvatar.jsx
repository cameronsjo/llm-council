/**
 * SeatAvatar — a rounded-square avatar in a model's seat color with a mono
 * initial. Used in the landing seat row, Stage-1 panel, Standings rows, Arena
 * cards, and the sidebar council display.
 *
 * @param {string} color - seat color, e.g. 'var(--seat-2)' (defaults to seat 1)
 * @param {string} [initial] - single glyph; derived from `name` when omitted
 * @param {string} [name] - full model name (for initial + title fallback)
 * @param {number} [size=26] - square edge in px
 */
export default function SeatAvatar({
  color = 'var(--seat-1)',
  initial,
  name,
  size = 26,
  title,
  style,
  className,
}) {
  const glyph = initial ?? (name ? name.trim()[0]?.toUpperCase() : '?');
  const px = `${size}px`;
  return (
    <span
      className={className}
      title={title ?? name}
      aria-label={title ?? name}
      role="img"
      style={{
        width: px,
        height: px,
        flex: 'none',
        borderRadius: '7px',
        background: color,
        color: 'var(--fg-on-accent)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-mono)',
        fontSize: `${Math.round(size * 0.42)}px`,
        fontWeight: 700,
        lineHeight: 1,
        ...style,
      }}
    >
      {glyph}
    </span>
  );
}
