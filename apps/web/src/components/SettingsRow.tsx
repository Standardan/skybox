import type { ReactNode } from "react";
import styles from "./SettingsRow.module.css";

/**
 * Reference: LT-04 (Linear) — flat, hairline-bordered, label-left/control-right
 * row. Deliberately opts out of the global focus-lift glow (DESIGN-BRIEF.md
 * §2 Reference Blend Contract — Settings screens stay calmer than content
 * screens); rows rely on the default `:focus-visible` outline from tokens.css.
 *
 * Lineage: row anatomy is native flexbox (not catalog-attributed, per
 * component-sourcing.md's structural-wrapper exemption). See §8 Component
 * Opportunity Map — SettingsRow row.
 */
interface SettingsRowProps {
  /** Visible label text. Rendered as a real <label htmlFor> when `htmlFor` is given. */
  label: string;
  /** Id of the single form control this row controls, for real label association. */
  htmlFor?: string;
  /** Optional helper/description text under the label. */
  hint?: string;
  children: ReactNode;
}

export function SettingsRow({ label, htmlFor, hint, children }: SettingsRowProps) {
  const hintId = hint && htmlFor ? `${htmlFor}-hint` : undefined;
  return (
    <div className={styles.row}>
      <div className={styles.labelCol}>
        {htmlFor ? (
          <label htmlFor={htmlFor} className={styles.label}>
            {label}
          </label>
        ) : (
          <span className={styles.label}>{label}</span>
        )}
        {hint ? (
          <p className={styles.hint} id={hintId}>
            {hint}
          </p>
        ) : null}
      </div>
      <div className={styles.controlCol}>{children}</div>
    </div>
  );
}

/**
 * Lineage: Uiverse Toggle-switches/Shubh0408_giant-swan-43 (native
 * `<input type="checkbox">` inside a track/thumb label) — retextured to
 * `--surface`/`--accent`, resized to row-control scale. See §8.
 */
interface SwitchProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Switch({ id, checked, onChange, disabled }: SwitchProps) {
  return (
    <label className={styles.switch} data-disabled={disabled ? "true" : undefined}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className={styles.switchInput}
      />
      <span className={styles.switchTrack} aria-hidden="true">
        <span className={styles.switchThumb} />
      </span>
    </label>
  );
}
