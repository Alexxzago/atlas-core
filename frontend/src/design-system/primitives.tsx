import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type InputHTMLAttributes, type OlHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TableHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";

type ElementProps = HTMLAttributes<HTMLDivElement> & { readonly children?: ReactNode };
type Space = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10";
type Tone = "neutral" | "info" | "success" | "warning" | "danger";
type TextareaSize = "compact" | "standard" | "long";

function classes(base: string, className?: string): string { return `${base} ${className ?? ""}`.trim(); }
function gapStyle(gap?: Space): CSSProperties | undefined { return gap === undefined ? undefined : { "--ds-gap": `var(--atlas-space-${gap})` } as CSSProperties; }

export function Stack({ className, gap, style, ...props }: ElementProps & { readonly gap?: Space }): React.JSX.Element { return <div {...props} className={classes("ds-stack", className)} style={{ ...gapStyle(gap), ...style }} />; }
export function Inline({ className, gap, wrap = false, style, ...props }: ElementProps & { readonly gap?: Space; readonly wrap?: boolean }): React.JSX.Element { return <div {...props} className={classes(`ds-inline${wrap ? " ds-inline--wrap" : ""}`, className)} style={{ ...gapStyle(gap), ...style }} />; }
export function Cluster({ className, ...props }: ElementProps): React.JSX.Element { return <div {...props} className={classes("ds-cluster", className)} />; }
export function Grid({ className, gap, columns, style, ...props }: ElementProps & { readonly gap?: Space; readonly columns?: number }): React.JSX.Element { return <div {...props} className={classes("ds-grid", className)} style={{ ...gapStyle(gap), ...(columns === undefined ? {} : { "--ds-grid-columns": columns }), ...style }} />; }
export function Page({ className, compact = false, ...props }: ElementProps & { readonly compact?: boolean }): React.JSX.Element { return <main {...props} className={classes(`ds-page${compact ? " ds-page--compact" : ""}`, className)} />; }
export function Container({ className, size = "content", ...props }: ElementProps & { readonly size?: "content" | "wide" | "narrow" }): React.JSX.Element { return <div {...props} className={classes(`ds-container ds-container--${size}`, className)} />; }
export function Surface({ className, tone = "default", padding = "standard", style, ...props }: ElementProps & { readonly tone?: "default" | "subtle" | "raised"; readonly padding?: Space | "standard" | "compact" }): React.JSX.Element { const value = padding === "standard" ? "var(--atlas-card-padding)" : padding === "compact" ? "var(--atlas-card-padding-compact)" : `var(--atlas-space-${padding})`; return <div {...props} className={classes(`ds-surface ds-surface--${tone}${padding === "compact" ? " ds-surface--compact" : ""}`, className)} style={{ "--ds-surface-padding": value, ...style } as CSSProperties} />; }
export function Card({ className, padding = "standard", style, ...props }: ElementProps & { readonly padding?: Space | "standard" | "compact" }): React.JSX.Element { const value = padding === "standard" ? "var(--atlas-card-padding)" : padding === "compact" ? "var(--atlas-card-padding-compact)" : `var(--atlas-space-${padding})`; return <section {...props} className={classes(`ds-card${padding === "compact" ? " ds-card--compact" : ""}`, className)} style={{ "--ds-surface-padding": value, ...style } as CSSProperties} />; }
export function Divider({ className, ...props }: Omit<ElementProps, "children">): React.JSX.Element { return <div {...props} className={classes("ds-divider", className)} role="separator" />; }
export function VisuallyHidden({ children }: { readonly children: ReactNode }): React.JSX.Element { return <span className="ds-visually-hidden">{children}</span>; }

export function PageHeader({ title, description, action, className }: { readonly title: string; readonly description?: string; readonly action?: ReactNode; readonly className?: string }): React.JSX.Element { return <header className={classes("ds-page-header", className)}><div className="ds-page-header__content"><h1 className="ds-page-header__title">{title}</h1>{description && <p className="ds-page-header__description">{description}</p>}</div>{action && <div className="ds-page-header__action">{action}</div>}</header>; }
export function BackNavigation({ children, className, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>): React.JSX.Element { return <a {...props} className={classes("ds-back-navigation", className)}>{children}</a>; }

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { readonly variant?: "primary" | "secondary" | "quiet" | "danger"; readonly size?: "sm" | "md" }>(function Button({ className, variant = "primary", size = "md", type = "button", ...props }, ref): React.JSX.Element { return <button {...props} ref={ref} type={type} className={classes(`ds-button ds-button--${variant} ds-button--${size}`, className)} />; });
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element { return <input {...props} className={classes("ds-control", className)} />; }
export function Textarea({ className, size = "standard", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { readonly size?: TextareaSize }): React.JSX.Element { return <textarea {...props} className={classes(`ds-control ds-textarea ds-textarea--${size}`, className)} />; }
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element { return <select {...props} className={classes("ds-control ds-select", className)}>{children}</select>; }
export function Checkbox({ className, ...props }: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element { return <input {...props} type="checkbox" className={classes("ds-checkbox", className)} />; }
export function Badge({ className, tone = "neutral", children }: { readonly className?: string; readonly tone?: Tone; readonly children: ReactNode }): React.JSX.Element { return <span className={classes(`ds-badge ds-badge--${tone}`, className)}>{children}</span>; }
export function Spinner({ label = "Loading" }: { readonly label?: string }): React.JSX.Element { return <span aria-label={label} className="ds-spinner" role="status"><VisuallyHidden>{label}</VisuallyHidden></span>; }
export function Skeleton({ label = "Loading", lines = 1 }: { readonly label?: string; readonly lines?: number }): React.JSX.Element { return <div aria-label={label} className="ds-skeleton" role="status"><VisuallyHidden>{label}</VisuallyHidden>{Array.from({ length: lines }, (_, index) => <span aria-hidden="true" key={index} />)}</div>; }

export interface TabDefinition { readonly id: string; readonly label: string; readonly disabled?: boolean; }
export function Tabs({ tabs, selectedId, onSelect, label }: { readonly tabs: readonly TabDefinition[]; readonly selectedId: string; readonly onSelect: (id: string) => void; readonly label: string }): React.JSX.Element { return <div aria-label={label} className="ds-tabs" role="tablist">{tabs.map((tab) => <button aria-selected={tab.id === selectedId} className="ds-tab" disabled={tab.disabled} key={tab.id} role="tab" type="button" onClick={() => onSelect(tab.id)}>{tab.label}</button>)}</div>; }
export interface StepDefinition { readonly label: string; readonly state: "upcoming" | "current" | "complete"; }
export function Stepper({ steps, label }: { readonly steps: readonly StepDefinition[]; readonly label: string }): React.JSX.Element { return <ol aria-label={label} className="ds-stepper">{steps.map((step, index) => <li className="ds-stepper__item" data-state={step.state} key={step.label}><span aria-hidden="true" className="ds-stepper__mark">{step.state === "complete" ? "✓" : index + 1}</span>{step.label}</li>)}</ol>; }
export function DataList({ className, ...props }: OlHTMLAttributes<HTMLOListElement>): React.JSX.Element { return <ol {...props} className={classes("ds-data-list", className)} />; }
export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>): React.JSX.Element { return <div className="ds-table-scroll"><table {...props} className={classes("ds-table", className)} /></div>; }

function focusableElements(dialog: HTMLElement): HTMLElement[] { return [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((element) => !element.hasAttribute("hidden")); }

export function ConfirmDialog({ open, title, description, cancelLabel, confirmLabel, confirmVariant = "danger", confirmDisabled = false, role = "alertdialog", onCancel, onConfirm, closeOnBackdropClick = false }: { readonly open: boolean; readonly title: string; readonly description?: string; readonly cancelLabel: string; readonly confirmLabel: string; readonly confirmVariant?: "primary" | "danger"; readonly confirmDisabled?: boolean; readonly role?: "alertdialog" | "dialog"; readonly onCancel: () => void; readonly onConfirm: () => void; readonly closeOnBackdropClick?: boolean }): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => { returnFocusRef.current?.focus(); };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") { event.preventDefault(); onCancel(); return; }
    if (event.key !== "Tab") return;
    const elements = dialogRef.current ? focusableElements(dialogRef.current) : [];
    if (elements.length === 0) { event.preventDefault(); return; }
    const first = elements[0]!;
    const last = elements[elements.length - 1]!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return createPortal(<div aria-hidden="false" className="ds-dialog-backdrop" onMouseDown={(event) => { if (closeOnBackdropClick && event.target === event.currentTarget) onCancel(); }}><div aria-describedby={description ? descriptionId : undefined} aria-labelledby={titleId} aria-modal="true" className="ds-dialog" ref={dialogRef} role={role} tabIndex={-1} onKeyDown={onKeyDown}><header className="ds-dialog__header"><h2 className="ds-dialog__title" id={titleId}>{title}</h2>{description && <p className="ds-dialog__description" id={descriptionId}>{description}</p>}</header><div className="ds-dialog__actions"><Button ref={cancelRef} variant="secondary" onClick={onCancel}>{cancelLabel}</Button><Button disabled={confirmDisabled} variant={confirmVariant} onClick={onConfirm}>{confirmLabel}</Button></div></div></div>, document.body);
}

export function styleWithGap(gap: string): CSSProperties { return { "--ds-gap": gap } as CSSProperties; }
export { Alert, EmptyState, ErrorState, LoadingState, ProgressIndicator, StatusBadge, SuccessState } from "./feedback";
