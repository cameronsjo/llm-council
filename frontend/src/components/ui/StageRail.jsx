import { Check } from 'lucide-react';

/**
 * StageRail — connected stage nodes driven by completed-stage state.
 *
 * Council: 3 stages (First opinions / Peer review / Synthesis).
 * Arena: 4 stages (Opening / Rebuttal / Closing / Verdict).
 *
 * Completed nodes fill with `--fg-subtle` and a check; the final node fills
 * ember when complete. Pending nodes show their number with a hairline ring.
 * Render this inside a `--bg-raised` card (the consumer owns the card chrome).
 *
 * @param {(string | { label: string, sublabel?: string })[]} stages
 * @param {number} [completedCount=0] - how many leading stages are done
 * @param {number} [size=26] - node diameter in px
 * @param {number} [gap=12] - connector-line margin in px
 */
export default function StageRail({ stages = [], completedCount = 0, size = 26, gap = 12 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
      {stages.map((st, i) => {
        const label = typeof st === 'string' ? st : st.label;
        const sublabel = typeof st === 'string' ? null : st.sublabel;
        const isLast = i === stages.length - 1;
        const complete = i < completedCount;
        const ember = isLast && complete;
        const node = {
          width: `${size}px`,
          height: `${size}px`,
          flex: 'none',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-mono)',
          fontSize: `${Math.round(size * 0.46)}px`,
          fontWeight: 700,
          background: complete ? (ember ? 'var(--accent)' : 'var(--fg-subtle)') : 'transparent',
          color: complete ? (ember ? 'var(--fg-on-accent)' : 'var(--bg)') : 'var(--fg-faint)',
          border: complete ? 'none' : '2px solid var(--line-strong)',
        };
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: sublabel ? '9px' : '8px',
                flex: 'none',
              }}
            >
              <span style={node}>
                {complete ? <Check size={Math.round(size * 0.5)} strokeWidth={3} /> : i + 1}
              </span>
              {sublabel ? (
                <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
                  <span
                    style={{
                      fontSize: '9.5px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--fg-faint)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {sublabel}
                  </span>
                  <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--fg)' }}>
                    {label}
                  </span>
                </div>
              ) : (
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg)' }}>
                  {label}
                </span>
              )}
            </div>
            {!isLast && (
              <div
                style={{
                  flex: 1,
                  height: '2px',
                  background: 'var(--line-strong)',
                  margin: `0 ${gap}px`,
                  minWidth: `${gap + 6}px`,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
