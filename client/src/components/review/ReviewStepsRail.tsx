import { Check } from 'lucide-react';

export interface RailStep {
  id: string;
  label: string;
  count: number | null;
}

/**
 * docs/59 §5.2: the steps as a real ordered list. Any step opens at any time (nothing is locked); a
 * step the manager has left behind shows a check, and the thread between marks turns to success.
 */
export function ReviewStepsRail({
  steps,
  currentIndex,
  left,
  onSelect,
  variant = 'rail',
}: {
  steps: RailStep[];
  currentIndex: number;
  left: ReadonlySet<string>;
  onSelect: (index: number) => void;
  /** `list` is the same list inside the phone step popover. */
  variant?: 'rail' | 'list';
}) {
  const list = (
    <ol className="review-steps">
      {steps.map((step, index) => {
        const isLeft = left.has(step.id) && index !== currentIndex;
        return (
          <li key={step.id} data-left={isLeft || undefined}>
            <button
              type="button"
              className="review-step"
              aria-label={`${step.label}${isLeft ? ', done' : ''}${step.count !== null ? `, ${step.count}` : ''}`}
              aria-current={index === currentIndex ? 'step' : undefined}
              data-left={isLeft || undefined}
              onClick={() => onSelect(index)}
            >
              <span className="review-step-mark" aria-hidden="true">
                {isLeft ? <Check size={13} strokeWidth={3} /> : index + 1}
              </span>
              <span className="review-step-label">{step.label}</span>
              {step.count !== null ? <span className="review-step-badge">{step.count}</span> : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
  if (variant === 'list') return <div className="p-1">{list}</div>;
  return (
    <nav className="review-rail" aria-label="Review steps">
      {list}
    </nav>
  );
}
