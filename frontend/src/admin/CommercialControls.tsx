import { useEffect, useState } from "react";
import { ApiError, atlasApi } from "../api/atlasApi";
import { StartupState } from "../components/StartupState";
import { useRouter } from "../routing/RouterProvider";
import type {
  CommercialControlAuditEvent,
  PlatformUserCommercialControls,
  PlatformWorkspaceCommercialControls,
} from "../types/api";
import {
  Alert,
  Button,
  DataList,
  Input,
  StatusBadge,
  Surface,
} from "../design-system/primitives";

function failure(error: unknown): string {
  return error instanceof ApiError && error.status === 409
    ? "La información cambió. Revisá el estado actual e intentá nuevamente."
    : "No pudimos completar la operación.";
}
function nullable(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}
function allowance(value: number | null): string {
  return value === null ? "Sin límite" : String(value);
}
function Usage({
  current,
  limit,
  label,
}: {
  readonly current: number;
  readonly limit: number | null;
  readonly label: string;
}): React.JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {current} / {allowance(limit)}
      </dd>
    </div>
  );
}
function Audit({
  items,
}: {
  readonly items: CommercialControlAuditEvent[];
}): React.JSX.Element {
  return (
    <Surface tone="subtle">
      <h2>Auditoría</h2>
      {items.length ? (
        <DataList>
          {items.map((item) => (
            <li key={item.id}>
              {item.eventType} v{item.version} {item.occurredAt}
            </li>
          ))}
        </DataList>
      ) : (
        <p>Sin cambios registrados.</p>
      )}
    </Surface>
  );
}

export function WorkspaceCommercialControls({
  id,
  csrf,
}: {
  readonly id: string;
  readonly csrf: string;
}): React.JSX.Element {
  const { navigate } = useRouter();
  const [controls, setControls] =
      useState<PlatformWorkspaceCommercialControls | null>(null),
    [audit, setAudit] = useState<CommercialControlAuditEvent[]>([]),
    [notice, setNotice] = useState<string | null>(null),
    [pending, setPending] = useState(false);
  useEffect(() => {
    void Promise.all([
      atlasApi.platformWorkspaceCommercialControls(id),
      atlasApi.platformWorkspaceCommercialAudit(id),
    ])
      .then(([value, events]) => {
        setControls(value);
        setAudit(events);
      })
      .catch(() => setNotice("No pudimos cargar los controles."));
  }, [id]);
  const reload = (): void => {
    void atlasApi.platformWorkspaceCommercialAudit(id).then(setAudit);
  };
  const limits = (): void => {
    if (!controls) return;
    setPending(true);
    void atlasApi
      .updatePlatformWorkspaceCommercialLimits(csrf, id, {
        expectedVersion: controls.version,
        maxCompanies: controls.maxCompanies,
        maxAssistantProfiles: controls.maxAssistantProfiles,
        maxActiveChannels: controls.maxActiveChannels,
      })
      .then((value) => {
        setControls(value);
        setNotice("Límites actualizados.");
        reload();
      })
      .catch((error) => setNotice(failure(error)))
      .finally(() => setPending(false));
  };
  const status = (action: "suspend" | "reactivate"): void => {
    if (!controls) return;
    setPending(true);
    void atlasApi
      .setPlatformWorkspaceCommercialStatus(csrf, id, action, controls.version)
      .then((value) => {
        setControls(value);
        setNotice(
          action === "suspend"
            ? "El workspace fue suspendido."
            : "El workspace fue reactivado.",
        );
        reload();
      })
      .catch((error) => setNotice(failure(error)))
      .finally(() => setPending(false));
  };
  if (!controls) return <StartupState />;
  return (
    <section className="admin-page">
      <Button variant="quiet" onClick={() => navigate("/admin/workspaces")}>
        Volver a clientes
      </Button>
      <header>
        <h1>Workspace {id}</h1>
        <StatusBadge tone={controls.status === "active" ? "success" : "danger"}>
          {controls.status}
        </StatusBadge>
      </header>
      <Surface aria-labelledby="workspace-usage" tone="subtle">
        <h2 id="workspace-usage">Uso actual</h2>
        <dl className="commercial-usage">
          <Usage
            label="Empresas"
            current={controls.usage.companies}
            limit={controls.maxCompanies}
          />
          <Usage
            label="Perfiles asistentes"
            current={controls.usage.assistantProfiles}
            limit={controls.maxAssistantProfiles}
          />
          <Usage
            label="Canales activos"
            current={controls.usage.activeChannels}
            limit={controls.maxActiveChannels}
          />
        </dl>
      </Surface>
      <label className="ds-field">
        Máximo de empresas
        <Input
          type="number"
          value={controls.maxCompanies ?? ""}
          onChange={(event) =>
            setControls({
              ...controls,
              maxCompanies: nullable(event.target.value),
            })
          }
        />
      </label>
      <label className="ds-field">
        Máximo de asistentes
        <Input
          type="number"
          value={controls.maxAssistantProfiles ?? ""}
          onChange={(event) =>
            setControls({
              ...controls,
              maxAssistantProfiles: nullable(event.target.value),
            })
          }
        />
      </label>
      <label className="ds-field">
        Máximo de canales activos
        <Input
          type="number"
          value={controls.maxActiveChannels ?? ""}
          onChange={(event) =>
            setControls({
              ...controls,
              maxActiveChannels: nullable(event.target.value),
            })
          }
        />
      </label>
      {notice && (
        <Alert
          tone={
            notice.startsWith("No pudimos") ||
            notice.startsWith("La información")
              ? "danger"
              : "success"
          }
        >
          {notice}
        </Alert>
      )}
      <div className="admin-actions">
        <Button disabled={pending} onClick={limits}>
          Guardar límites
        </Button>
        <Button
          variant="danger"
          disabled={pending || controls.status === "suspended"}
          onClick={() => status("suspend")}
        >
          Suspender workspace
        </Button>
        <Button
          variant="secondary"
          disabled={pending || controls.status === "active"}
          onClick={() => status("reactivate")}
        >
          Reactivar workspace
        </Button>
      </div>
      <Audit items={audit} />
    </section>
  );
}

export function UserOwnedWorkspaceAllowance({
  id,
  csrf,
}: {
  readonly id: string;
  readonly csrf: string;
}): React.JSX.Element {
  const { navigate } = useRouter();
  const [controls, setControls] =
      useState<PlatformUserCommercialControls | null>(null),
    [audit, setAudit] = useState<CommercialControlAuditEvent[]>([]),
    [allowanceValue, setAllowance] = useState(""),
    [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    void Promise.all([
      atlasApi.platformUserCommercialControls(id),
      atlasApi.platformUserCommercialAudit(id),
    ])
      .then(([value, events]) => {
        setControls(value);
        setAllowance(
          value.maxOwnedWorkspaces === null
            ? ""
            : String(value.maxOwnedWorkspaces),
        );
        setAudit(events);
      })
      .catch(() => setNotice("No pudimos cargar los controles."));
  }, [id]);
  const save = (): void => {
    if (!controls) return;
    void atlasApi
      .updatePlatformUserOwnedWorkspaceAllowance(
        csrf,
        id,
        nullable(allowanceValue),
        controls.version,
      )
      .then((value) => {
        setControls(value);
        setNotice("El límite de workspaces propios fue actualizado.");
        return atlasApi.platformUserCommercialAudit(id);
      })
      .then(setAudit)
      .catch((error) => setNotice(failure(error)));
  };
  if (!controls) return <StartupState />;
  return (
    <section className="admin-page">
      <Button variant="quiet" onClick={() => navigate("/admin/users")}>
        Volver a usuarios
      </Button>
      <header>
        <h1>Límite de workspaces</h1>
      </header>
      <Surface aria-labelledby="owned-workspace-usage" tone="subtle">
        <h2 id="owned-workspace-usage">Uso actual</h2>
        <dl className="commercial-usage">
          <Usage
            label="Workspaces propios"
            current={controls.usage.ownedWorkspaces}
            limit={controls.maxOwnedWorkspaces}
          />
        </dl>
      </Surface>
      <label className="ds-field">
        Límite de workspaces propios
        <Input
          type="number"
          aria-label="Límite de workspaces propios"
          inputMode="numeric"
          value={allowanceValue}
          onChange={(event) => setAllowance(event.target.value)}
        />
      </label>
      {notice && (
        <Alert
          tone={
            notice.startsWith("No pudimos") ||
            notice.startsWith("La información")
              ? "danger"
              : "success"
          }
        >
          {notice}
        </Alert>
      )}
      <Button onClick={save}>Guardar límite</Button>
      <Audit items={audit} />
    </section>
  );
}
