import React from "react";

interface Props {
  readonly companyName: string;
  readonly isReady?: boolean;
  readonly primaryActionLabel?: string;
  readonly onPrimaryAction?: () => void;
  readonly secondaryActionLabel?: string;
  readonly onSecondaryAction?: () => void;
}

export function TodayHero({
  companyName,
  isReady = true,
  primaryActionLabel,
  onPrimaryAction,
  secondaryActionLabel,
  onSecondaryAction,
}: Props): React.JSX.Element {
  return (
    <section className="today-hero" aria-label="Resumen operativo">
      <div className="today-hero__glow" aria-hidden="true" />
      <div className="today-hero__layout">
        <div className="today-hero__main">
          <div className="today-hero__header">
            <div className="today-hero__badge">
              <span className="today-hero__status-dot" />
              <span className="today-hero__status-text">
                {isReady ? "Atlas operativo" : "Configuración en curso"}
              </span>
            </div>
            {companyName && (
              <span className="today-hero__company-context">
                Empresa activa: <strong>{companyName}</strong>
              </span>
            )}
          </div>

          <h1 className="today-hero__title">
            Atlas <span className="today-hero__title-gold">operativo</span>
          </h1>

          <p className="today-hero__subtitle">
            {isReady
              ? "El conocimiento de tu empresa, siempre disponible. Asistente entrenado, canales integrados y control operativo en tiempo real."
              : "Configuración en curso para habilitar la atención autónoma y los canales de comunicación de tu empresa."}
          </p>

          {(onPrimaryAction || onSecondaryAction) && (
            <div className="today-hero__actions">
              {onPrimaryAction && primaryActionLabel && (
                <button
                  type="button"
                  className="today-hero__btn-primary"
                  onClick={onPrimaryAction}
                >
                  {primaryActionLabel}
                </button>
              )}
              {onSecondaryAction && secondaryActionLabel && (
                <button
                  type="button"
                  className="today-hero__btn-secondary"
                  onClick={onSecondaryAction}
                >
                  <span className="today-hero__play-icon" aria-hidden="true">▶</span>
                  {secondaryActionLabel}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="today-hero__aside" aria-hidden="true">
          <div className="today-hero__quote-card">
            <div className="today-hero__quote-badge">PROPÓSITO ATLAS</div>
            <p className="today-hero__quote-text">
              &ldquo;EL CONOCIMIENTO DE TU EMPRESA, SIEMPRE DISPONIBLE.&rdquo;
            </p>
            <p className="today-hero__quote-desc">
              Atlas centraliza la información de tu negocio, atiende consultas con IA y escala la operación de tu equipo de forma autónoma.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
