import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

type ElementProps = HTMLAttributes<HTMLDivElement> & { readonly children?: ReactNode };

export function Stack({ className = "", ...props }: ElementProps): React.JSX.Element {
  return <div {...props} className={`ds-stack ${className}`.trim()} />;
}

export function Inline({ className = "", ...props }: ElementProps): React.JSX.Element {
  return <div {...props} className={`ds-inline ${className}`.trim()} />;
}

export function Cluster({ className = "", ...props }: ElementProps): React.JSX.Element {
  return <div {...props} className={`ds-cluster ${className}`.trim()} />;
}

export function Grid({ className = "", ...props }: ElementProps): React.JSX.Element {
  return <div {...props} className={`ds-grid ${className}`.trim()} />;
}

export function Container({ className = "", ...props }: ElementProps): React.JSX.Element {
  return <div {...props} className={`ds-container ${className}`.trim()} />;
}

export function Divider({ className = "", ...props }: Omit<ElementProps, "children">): React.JSX.Element {
  return <div {...props} className={`ds-divider ${className}`.trim()} role="separator" />;
}

export function VisuallyHidden({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return <span className="ds-visually-hidden">{children}</span>;
}

export function styleWithGap(gap: string): CSSProperties {
  return { "--ds-gap": gap } as CSSProperties;
}
