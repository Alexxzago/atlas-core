import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

function classes(base: string, className?: string): string { return `${base} ${className ?? ""}`.trim(); }

type DivProps = HTMLAttributes<HTMLDivElement> & { readonly children?: ReactNode };

export function ProductPage({ className, ...props }: DivProps): React.JSX.Element {
  return <div {...props} className={classes("atlas-page", className)} />;
}

export function ProductHero({ eyebrow, title, description, action, className }: { readonly eyebrow?: string; readonly title: string; readonly description?: string; readonly action?: ReactNode; readonly className?: string }): React.JSX.Element {
  return <header className={classes("atlas-hero", className)}><div>{eyebrow && <p className="atlas-eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className="atlas-hero__action">{action}</div>}</header>;
}

export function Section({ title, description, action, children, className, ...props }: HTMLAttributes<HTMLElement> & { readonly title?: string; readonly description?: string; readonly action?: ReactNode; readonly children: ReactNode }): React.JSX.Element {
  return <section {...props} className={classes("atlas-section", className)}>{(title || description || action) && <header className="atlas-section__header"><div>{title && <h2>{title}</h2>}{description && <p>{description}</p>}</div>{action && <div>{action}</div>}</header>}<div className="atlas-section__content">{children}</div></section>;
}

export function ObjectSurface({ children, className, emphasis = "default", ...props }: DivProps & { readonly emphasis?: "default" | "featured" | "muted" }): React.JSX.Element {
  return <article {...props} className={classes(`atlas-object atlas-object--${emphasis}`, className)}>{children}</article>;
}

export function ObjectGrid({ children, className }: { readonly children: ReactNode; readonly className?: string }): React.JSX.Element {
  return <div className={classes("atlas-object-grid", className)}>{children}</div>;
}

export function ContextPanel({ label, children, className }: { readonly label: string; readonly children: ReactNode; readonly className?: string }): React.JSX.Element {
  return <aside aria-label={label} className={classes("atlas-context", className)}><p className="atlas-eyebrow">{label}</p>{children}</aside>;
}

export function Callout({ title, children, tone = "info", className }: { readonly title: string; readonly children: ReactNode; readonly tone?: "info" | "success" | "warning" | "danger"; readonly className?: string }): React.JSX.Element {
  return <aside className={classes(`atlas-callout atlas-callout--${tone}`, className)}><strong>{title}</strong><div>{children}</div></aside>;
}

export function EmptyExperience({ title, description, action, className }: { readonly title: string; readonly description: string; readonly action?: ReactNode; readonly className?: string }): React.JSX.Element {
  return <div className={classes("atlas-empty", className)}><span aria-hidden="true" className="atlas-empty__signal"/><h2>{title}</h2><p>{description}</p>{action && <div>{action}</div>}</div>;
}

export function StepList({ children, className }: { readonly children: ReactNode; readonly className?: string }): React.JSX.Element {
  return <ol className={classes("atlas-step-list", className)}>{children}</ol>;
}

export function IconButton({ label, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { readonly label: string }): React.JSX.Element {
  return <button {...props} aria-label={label} className={classes("atlas-icon-button", className)} title={label} type={props.type ?? "button"}>{children}</button>;
}
