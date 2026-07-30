import type { ReactNode } from "react";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

export function Alert({ tone = "info", children }: { readonly tone?: Tone; readonly children: ReactNode }): React.JSX.Element {
  return <div className={`ds-alert ds-alert--${tone}`} role={tone === "danger" ? "alert" : "status"}>{children}</div>;
}

export function StatusIndicator({ tone = "neutral", children }: { readonly tone?: Tone; readonly children: ReactNode }): React.JSX.Element {
  return <span className={`ds-status ds-status--${tone}`}><span aria-hidden="true" className="ds-status__mark" />{children}</span>;
}

export function Skeleton({ label, lines = 2 }: { readonly label: string; readonly lines?: number }): React.JSX.Element {
  return <div className="ds-skeleton" role="status"><span className="ds-visually-hidden">{label}</span>{Array.from({ length: lines }, (_, index) => <span aria-hidden="true" key={index} />)}</div>;
}

export function EmptyState({ title, description }: { readonly title: string; readonly description: string }): React.JSX.Element {
  return <div className="ds-empty-state"><h2>{title}</h2><p>{description}</p></div>;
}

export function ErrorState({ title, description, action }: { readonly title: string; readonly description: string; readonly action?: ReactNode }): React.JSX.Element {
  return <div className="ds-error-state" role="alert"><h2>{title}</h2><p>{description}</p>{action}</div>;
}

export function ProgressIndicator({ label }: { readonly label: string }): React.JSX.Element {
  return <div className="ds-progress" role="status"><span className="ds-progress__spinner" aria-hidden="true" />{label}</div>;
}
