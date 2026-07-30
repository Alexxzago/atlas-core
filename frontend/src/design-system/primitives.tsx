import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

type ElementProps = HTMLAttributes<HTMLDivElement> & { readonly children?: ReactNode };
type Space = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10";
type Tone = "neutral" | "info" | "success" | "warning" | "danger";

function classes(base: string, className?: string): string { return `${base} ${className ?? ""}`.trim(); }
function gapStyle(gap?: Space): CSSProperties | undefined { return gap === undefined ? undefined : { "--ds-gap": `var(--atlas-space-${gap})` } as CSSProperties; }

export function Stack({ className, gap, style, ...props }: ElementProps & { readonly gap?: Space }): React.JSX.Element { return <div {...props} className={classes("ds-stack", className)} style={{ ...gapStyle(gap), ...style }} />; }
export function Inline({ className, gap, wrap = false, style, ...props }: ElementProps & { readonly gap?: Space; readonly wrap?: boolean }): React.JSX.Element { return <div {...props} className={classes(`ds-inline${wrap ? " ds-inline--wrap" : ""}`, className)} style={{ ...gapStyle(gap), ...style }} />; }
export function Cluster({ className, ...props }: ElementProps): React.JSX.Element { return <div {...props} className={classes("ds-cluster", className)} />; }
export function Grid({ className, gap, columns, style, ...props }: ElementProps & { readonly gap?: Space; readonly columns?: number }): React.JSX.Element { return <div {...props} className={classes("ds-grid", className)} style={{ ...gapStyle(gap), ...(columns === undefined ? {} : { "--ds-grid-columns": columns }), ...style }} />; }
export function Container({ className, size = "content", ...props }: ElementProps & { readonly size?: "content" | "wide" | "narrow" }): React.JSX.Element { return <div {...props} className={classes(`ds-container ds-container--${size}`, className)} />; }
export function Surface({ className, tone = "default", padding = "5", ...props }: ElementProps & { readonly tone?: "default" | "subtle" | "raised"; readonly padding?: Space }): React.JSX.Element { return <div {...props} className={classes(`ds-surface ds-surface--${tone}`, className)} style={{ "--ds-surface-padding": `var(--atlas-space-${padding})`, ...props.style } as CSSProperties} />; }
export function Divider({ className, ...props }: Omit<ElementProps, "children">): React.JSX.Element { return <div {...props} className={classes("ds-divider", className)} role="separator" />; }
export function VisuallyHidden({ children }: { readonly children: ReactNode }): React.JSX.Element { return <span className="ds-visually-hidden">{children}</span>; }

export function Button({ className, variant = "primary", size = "md", type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { readonly variant?: "primary" | "secondary" | "quiet" | "danger"; readonly size?: "sm" | "md" }): React.JSX.Element { return <button {...props} type={type} className={classes(`ds-button ds-button--${variant} ds-button--${size}`, className)} />; }
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element { return <input {...props} className={classes("ds-control", className)} />; }
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>): React.JSX.Element { return <textarea {...props} className={classes("ds-control ds-textarea", className)} />; }
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element { return <select {...props} className={classes("ds-control ds-select", className)}>{children}</select>; }
export function Checkbox({ className, ...props }: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element { return <input {...props} type="checkbox" className={classes("ds-checkbox", className)} />; }
export function Card({ className, ...props }: ElementProps): React.JSX.Element { return <section {...props} className={classes("ds-card", className)} />; }
export function Badge({ className, tone = "neutral", children }: { readonly className?: string; readonly tone?: Tone; readonly children: ReactNode }): React.JSX.Element { return <span className={classes(`ds-badge ds-badge--${tone}`, className)}>{children}</span>; }
export function Spinner({ label = "Loading" }: { readonly label?: string }): React.JSX.Element { return <span aria-label={label} className="ds-spinner" role="status"><VisuallyHidden>{label}</VisuallyHidden></span>; }
export function Skeleton({ label = "Loading", lines = 1 }: { readonly label?: string; readonly lines?: number }): React.JSX.Element { return <div aria-label={label} className="ds-skeleton" role="status"><VisuallyHidden>{label}</VisuallyHidden>{Array.from({ length: lines }, (_, index) => <span aria-hidden="true" key={index} />)}</div>; }

export function styleWithGap(gap: string): CSSProperties { return { "--ds-gap": gap } as CSSProperties; }
export { Alert } from "./feedback";
