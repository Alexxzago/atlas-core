import React from "react";
import { Button } from "../design-system/primitives";

interface Props {
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
  readonly onAction: () => void;
  readonly stepNumber?: number;
  readonly badgeText?: string;
  readonly disabled?: boolean;
}

export function NextStepCard({
  title,
  description,
  actionLabel,
  onAction,
  stepNumber,
  badgeText = "Próximo paso",
  disabled = false,
}: Props): React.JSX.Element {
  return (
    <section className="next-step-card" aria-label="Próximo paso sugerido">
      <div className="next-step-card__header">
        <span className="next-step-card__badge">{badgeText}</span>
        {stepNumber !== undefined && (
          <span className="next-step-card__step-number">Paso {stepNumber}</span>
        )}
      </div>
      <div className="next-step-card__body">
        <h3 className="next-step-card__title">{title}</h3>
        <p className="next-step-card__description">{description}</p>
      </div>
      <div className="next-step-card__footer">
        <Button
          variant="primary"
          className="next-step-card__action"
          onClick={onAction}
          disabled={disabled}
        >
          {actionLabel}
        </Button>
      </div>
    </section>
  );
}
