import type { ReactNode } from "react";

interface Props {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly error?: string | null;
  readonly children: ReactNode;
}

export function Field({ id, label, description, error, children }: Props): React.JSX.Element {
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return <div className="ds-field">
    <label className="ds-field__label" htmlFor={id}>{label}</label>
    {description && <p className="ds-field__description" id={descriptionId}>{description}</p>}
    {children}
    {error && <p className="ds-field__error" id={errorId} role="alert">{error}</p>}
  </div>;
}

export function fieldDescribedBy(id: string, hasDescription: boolean, hasError: boolean): string | undefined {
  const values = [hasDescription ? `${id}-description` : null, hasError ? `${id}-error` : null].filter(Boolean);
  return values.length > 0 ? values.join(" ") : undefined;
}
