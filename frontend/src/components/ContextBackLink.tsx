import type { MouseEventHandler } from "react";
import { BackNavigation, Button } from "../design-system/primitives";

interface Props { readonly href?: string; readonly label: string; readonly onNavigate?: MouseEventHandler<HTMLAnchorElement>; readonly onBack?: () => void; }

export function ContextBackLink({ href, label, onNavigate, onBack }: Props): React.JSX.Element {
  return <nav className="context-back-navigation" aria-label={label}>{onBack ? <Button className="ds-back-navigation" variant="quiet" onClick={onBack}><span aria-hidden="true">←</span><span>{label}</span></Button> : <BackNavigation href={href!} onClick={onNavigate}><span aria-hidden="true">←</span><span>{label}</span></BackNavigation>}</nav>;
}
