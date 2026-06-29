/**
 * BrandMark — the LLM Council logo: three descending horizontal bars (a
 * "ranking" motif tying the mark to the app's peer-review signature) inside an
 * ember rounded square.
 *
 * @param {number} [size=30] - square edge in px
 */
export default function BrandMark({ size = 30 }) {
  const bar = (width, opacity) => ({
    height: '2.5px',
    width: `${width}px`,
    borderRadius: '2px',
    background: 'var(--fg-on-accent)',
    opacity,
  });
  return (
    <div
      aria-hidden="true"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        flex: 'none',
        borderRadius: '8px',
        background: 'var(--accent)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'center',
        gap: '3px',
        padding: '0 8px',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <span style={bar(14, 1)} />
      <span style={bar(9, 0.68)} />
      <span style={bar(5, 0.45)} />
    </div>
  );
}
