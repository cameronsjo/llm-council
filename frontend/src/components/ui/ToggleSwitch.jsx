/**
 * ToggleSwitch — 38x22 track with a 16px knob sliding 2<->18px. The "on" color
 * is the model's seat / provider color so the control reads in-palette.
 *
 * @param {boolean} checked
 * @param {(next: boolean) => void} onChange
 * @param {string} [color='var(--accent)'] - track color when on
 * @param {boolean} [disabled]
 * @param {string} [ariaLabel]
 */
export default function ToggleSwitch({
  checked = false,
  onChange,
  color = 'var(--accent)',
  disabled = false,
  ariaLabel,
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange?.(!checked);
      }}
      style={{
        width: '38px',
        height: '22px',
        flex: 'none',
        padding: 0,
        borderRadius: '999px',
        background: checked ? color : 'var(--bg-sunken)',
        border: `1px solid ${checked ? color : 'var(--line-strong)'}`,
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition:
          'background var(--dur-standard) var(--ease-out), border-color var(--dur-standard) var(--ease-out)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: '2px',
          left: checked ? '18px' : '2px',
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          background: '#fff',
          boxShadow: 'var(--shadow-sm)',
          transition: 'left var(--dur-standard) var(--ease-out)',
        }}
      />
    </button>
  );
}
