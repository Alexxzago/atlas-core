import type { ProductBootstrapProgress } from "../routing/productBootstrap";
import { LoadingState, Page } from "../design-system/primitives";

interface Props { readonly progress: ProductBootstrapProgress; }

const stageLabel = {
  memberships: "Verificando tu cuenta",
  workspace: "Cargando tu espacio",
  companies: "Preparando tus empresas",
  company: "Resolviendo tu empresa",
  permissions: "Aplicando tu configuración",
  session: "Verificando tu cuenta",
} as const;

export function ProductBootstrapState({ progress }: Props): React.JSX.Element {
  const complete = progress.completedStages.length;
  return <Page className="product-bootstrap" aria-busy="true" aria-live="polite" aria-labelledby="product-bootstrap-title">
    <div className="product-bootstrap__content">
      <p className="work-anchor__context">ATLAS</p>
      <h1 id="product-bootstrap-title">Estamos preparando tu espacio</h1>
      <LoadingState title="Estamos cargando tu empresa, permisos y configuración."/>
      <div className="product-bootstrap__progress" role="progressbar" aria-label={stageLabel[progress.currentStage]} aria-valuemin={0} aria-valuemax={6} aria-valuenow={complete}>
        {Array.from({ length: 6 }, (_, index) => <span key={index} data-complete={index < complete}/>) }
      </div>
      <p className="product-bootstrap__stage">{stageLabel[progress.currentStage]}</p>
    </div>
  </Page>;
}
