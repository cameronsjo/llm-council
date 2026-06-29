/**
 * KpiCard — a Standings KPI tile: a mono uppercase micro-label, a big mono
 * value, and an optional subline.
 *
 * @param {string} label - uppercase micro-label
 * @param {string|number} value - the headline figure (rendered mono)
 * @param {string} [sub] - small supporting line
 */
export default function KpiCard({ label, value, sub }) {
  return (
    <div
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--line)',
        borderRadius: '12px',
        padding: '16px',
      }}
    >
      <div
        style={{
          fontSize: '10px',
          fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--fg-faint)',
          marginBottom: '8px',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '26px',
          fontWeight: 700,
          fontFamily: 'var(--font-mono)',
          letterSpacing: '-0.02em',
          color: 'var(--fg)',
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {sub != null && (
        <div style={{ fontSize: '11px', color: 'var(--fg-subtle)', marginTop: '6px' }}>{sub}</div>
      )}
    </div>
  );
}
