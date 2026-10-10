import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * docs/73 UXD-05: the one select. A native <select> (keyboard, screen readers and
 * phone pickers for free) dressed as a `ui-field`: 8px radius, hairline border,
 * focus ring and a chevron. `size="sm"` is the 28px toolbar control; `variant="quiet"`
 * is the borderless in-place editor (triage properties, table cells).
 * `className` sizes the wrapper (w-full, flex-1, ml-auto…); the select fills it.
 */
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'md' | 'sm';
  variant?: 'field' | 'quiet';
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = 'md', variant = 'field', className, style, children, ...props },
  ref,
) {
  return (
    <span className={`ui-select${className ? ` ${className}` : ''}`} data-size={size} data-variant={variant}>
      <select ref={ref} style={style} {...props}>
        {children}
      </select>
      <ChevronDown size={size === 'sm' ? 12 : 14} className="ui-select-chevron" aria-hidden="true" />
    </span>
  );
});
