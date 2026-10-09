/**
 * Form primitives — MUI's `TextField`, `InputAdornment`, `Switch` and
 * `ToggleButton(Group)`, rebuilt on native controls.
 *
 *  - `TextField` renders the outlined variant with the label **above** the
 *    box (Apple-style; the floating label was MUI ceremony the reskin does
 *    not want). `startAdornment`/`endAdornment` replace MUI's
 *    `slotProps.input` shape. `helperText` always renders when passed —
 *    including `' '` — so form layouts keep the reserved line, exactly as
 *    the call sites that pass `error ?? ' '` expect.
 *  - `Switch` keeps MUI's `(event, checked)` change signature.
 *  - `ToggleButtonGroup` is a segmented control driven by context, so no
 *    children are cloned.
 */
import {
  createContext,
  useContext,
  type ChangeEvent,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

import { cn } from '../../utils/cn';

/* ── TextField ────────────────────────────────────────────────────────── */

interface TextFieldProps {
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  placeholder?: string;
  /** Floating-label text — rendered as a caption above the input. */
  label?: string;
  type?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  fullWidth?: boolean;
  /** MUI size: `small` is the 36px box, `medium` the 44px box. */
  size?: 'small' | 'medium';
  /** MUI compat — `dense` tightens the field's vertical rhythm. */
  margin?: 'dense' | 'none';
  /** Reserved line under the box; `' '` shows nothing but keeps the height. */
  helperText?: ReactNode;
  error?: boolean;
  multiline?: boolean;
  rows?: number;
  minRows?: number;
  startAdornment?: ReactNode;
  endAdornment?: ReactNode;
  /** MUI `inputProps` — aria attributes etc., spread onto the control (`any`
   *  so the same object type types both the input and textarea branches). */
  inputProps?: InputHTMLAttributes<any>;
  className?: string;
  inputClassName?: string;
  name?: string;
  id?: string;
  'aria-label'?: string;
}

/** MUI `TextField` (outlined) — native input in a token-styled box. */
export function TextField({
  value,
  onChange,
  placeholder,
  label,
  type = 'text',
  disabled,
  autoFocus,
  fullWidth,
  size = 'medium',
  margin,
  helperText,
  error,
  multiline,
  rows,
  minRows,
  startAdornment,
  endAdornment,
  inputProps,
  className,
  inputClassName,
  ...rest
}: TextFieldProps) {
  const dense = margin === 'dense';
  const control = multiline ? (
    <textarea
      {...rest}
      {...inputProps}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      rows={rows ?? minRows}
      className={cn(
        'w-full resize-y bg-transparent px-3 py-2 text-sm text-body outline-none',
        'placeholder:text-muted disabled:cursor-not-allowed disabled:text-disabled',
        inputClassName,
      )}
    />
  ) : (
    <input
      {...rest}
      {...inputProps}
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      className={cn(
        'w-full min-w-0 bg-transparent text-sm text-body outline-none',
        'placeholder:text-muted disabled:cursor-not-allowed disabled:text-disabled',
        dense ? 'py-1.5' : 'py-2.5',
        inputClassName,
      )}
    />
  );

  return (
    <div className={cn('flex flex-col', dense ? 'gap-1' : 'gap-1.5', fullWidth && 'w-full', className)}>
      {label ? (
        <label className="text-xs font-semibold text-muted">{label}</label>
      ) : null}
      <div
        className={cn(
          'flex items-center rounded-card border bg-surface transition-colors duration-150',
          'focus-within:border-accent',
          error ? 'border-error' : 'border-line',
          disabled && 'opacity-60',
          multiline ? 'items-stretch' : 'h-11',
          size === 'small' && !multiline && 'h-9',
        )}
      >
        {startAdornment ? <InputAdornment position="start">{startAdornment}</InputAdornment> : null}
        {control}
        {endAdornment ? <InputAdornment position="end">{endAdornment}</InputAdornment> : null}
      </div>
      {helperText !== undefined ? (
        <p className={cn('min-h-[1em] text-xs leading-4', error ? 'text-error' : 'text-muted')}>
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

/** MUI `InputAdornment` — icon/button slot pinned inside the field box. */
export function InputAdornment({
  position,
  children,
  className,
}: {
  position?: 'start' | 'end';
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center text-muted',
        position === 'end' ? 'pl-1 pr-2' : 'pr-1 pl-3',
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ── Switch ───────────────────────────────────────────────────────────── */

interface SwitchProps {
  checked: boolean;
  /** MUI signature: `(event, checked)`. */
  onChange: (event: React.MouseEvent<HTMLButtonElement>, checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  /** MUI `inputProps` — only `aria-label` was ever passed. */
  inputProps?: { 'aria-label'?: string };
}

/** MUI `Switch` — pill toggle, accent track when on. */
export function Switch({ checked, onChange, disabled, className, inputProps }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={inputProps?.['aria-label']}
      disabled={disabled}
      onClick={(event) => onChange(event, !checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200',
        'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2',
        checked ? 'bg-accent' : 'bg-[rgba(0,0,0,0.38)] dark:bg-[rgba(255,255,255,0.3)]',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-200',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

/* ── ToggleButton(Group) ──────────────────────────────────────────────── */

interface GroupContextValue {
  value: unknown;
  onChange: (event: React.MouseEvent<HTMLButtonElement>, value: unknown) => void;
}

const GroupContext = createContext<GroupContextValue | null>(null);

interface ToggleButtonGroupProps {
  value: unknown;
  /** MUI signature: `(event, value)` — `value` is null when deselecting. */
  onChange: (event: React.MouseEvent<HTMLButtonElement>, value: unknown) => void;
  /** The app only ever used exclusive groups. */
  exclusive?: boolean;
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
}

/** MUI `ToggleButtonGroup` — segmented control; children read context. */
export function ToggleButtonGroup({
  value,
  onChange,
  children,
  className,
  ...rest
}: ToggleButtonGroupProps) {
  return (
    <GroupContext.Provider value={{ value, onChange }}>
      <div
        role="group"
        {...rest}
        className={cn(
          'inline-flex items-center gap-0.5 rounded-card border border-line bg-surface p-0.5',
          className,
        )}
      >
        {children}
      </div>
    </GroupContext.Provider>
  );
}

interface ToggleButtonProps {
  value: unknown;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

/** MUI `ToggleButton` — one segment. */
export function ToggleButton({ value, children, disabled, className, ...rest }: ToggleButtonProps) {
  const ctx = useContext(GroupContext);
  const selected = ctx?.value === value;
  return (
    <button
      type="button"
      aria-pressed={selected}
      {...rest}
      disabled={disabled}
      onClick={(event) => ctx?.onChange(event, value)}
      className={cn(
        'rounded-[10px] px-3 py-1.5 text-sm font-medium transition-colors duration-150',
        'focus-visible:outline-2 focus-visible:outline-accent',
        'disabled:pointer-events-none disabled:opacity-40',
        selected ? 'bg-accent text-accent-contrast' : 'text-muted hover:bg-hover',
        className,
      )}
    >
      {children}
    </button>
  );
}
