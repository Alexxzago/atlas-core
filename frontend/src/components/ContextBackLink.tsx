import type { MouseEventHandler } from "react";

interface Props { readonly href: string; readonly label: string; readonly onNavigate?: MouseEventHandler<HTMLAnchorElement>; }

export function ContextBackLink({ href, label, onNavigate }: Props): React.JSX.Element {
  return <nav className="context-back-navigation" aria-label={label}><a className="context-back-link" href={href} onClick={onNavigate}><span aria-hidden="true">←</span><span>{label}</span></a></nav>;
}
