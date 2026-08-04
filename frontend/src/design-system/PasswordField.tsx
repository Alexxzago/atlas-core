import { useState, type InputHTMLAttributes } from "react";
import { fieldDescribedBy, Field } from "./Field";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type"> {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly error?: string | null;
  readonly showLabel: string;
  readonly hideLabel: string;
}

export function PasswordField({ id, label, description, error, showLabel, hideLabel, ...props }: Props): React.JSX.Element {
  const [visible, setVisible] = useState(false);
  return <Field id={id} label={label} {...(description === undefined ? {} : { description })} {...(error === undefined ? {} : { error })}>
    <div className="ds-password-field">
      <input {...props} aria-describedby={fieldDescribedBy(id, Boolean(description), Boolean(error))} aria-invalid={error ? true : undefined} className="ds-control" id={id} type={visible ? "text" : "password"} />
      <button aria-label={visible ? hideLabel : showLabel} aria-pressed={visible} className="ds-password-field__toggle" type="button" onClick={() => setVisible((current) => !current)}>{visible ? hideLabel : showLabel}</button>
    </div>
  </Field>;
}
