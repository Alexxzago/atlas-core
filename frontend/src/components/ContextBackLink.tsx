import type { MouseEventHandler } from "react";

interface Props { readonly href?: string; readonly label: string; readonly onNavigate?: MouseEventHandler<HTMLAnchorElement>; readonly onBack?: () => void; }

export function ContextBackLink({ href, label, onNavigate, onBack }: Props): React.JSX.Element {
  return <nav className="context-back-navigation" aria-label={label}>{onBack ? <button className="context-back-link" type="button" onClick={onBack}><span aria-hidden="true">←</span><span>{label}</span></button> : <a className="context-back-link" href={href!} onClick={onNavigate}><span aria-hidden="true">←</span><span>{label}</span></a>}</nav>;
}
