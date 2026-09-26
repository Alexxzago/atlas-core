import { useEffect, useRef, useState } from "react";
import { ApiError, atlasApi } from "../api/atlasApi";
import type {
  AssistantToolCatalog,
  Permission,
  ProactiveActionPolicy,
  SchedulingConfiguration,
} from "../types/api";
import {
  Alert,
  Button,
  Checkbox,
  ConfirmDialog,
  Input,
  LoadingState,
  Select,
  StatusBadge,
} from "../design-system/primitives";

interface Props {
  csrf: string;
  workspaceId: string | null;
  companyId: number | null;
  profileId: string;
  capabilities: Permission[];
  onNavigate: (path: string) => void;
}
type Operation =
  | "create_location"
  | "update_location"
  | "create_resource"
  | "update_resource"
  | "create_service"
  | "update_service"
  | "replace_weekly_availability"
  | "add_date_exception"
  | "remove_date_exception";
type LocationForm = {
  name: string;
  address: string;
  timezone: string;
  active: boolean;
};
type ResourceForm = {
  name: string;
  locationId: string;
  timezone: string;
  capacity: number;
  active: boolean;
};
type ServiceForm = {
  name: string;
  resourceId: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  slotGranularityMinutes: number;
  minimumLeadMinutes: number;
  maximumHorizonDays: number;
  active: boolean;
};
type AutomationTab =
  | "agenda"
  | "followups"
  | "locations"
  | "resources"
  | "services"
  | "availability"
  | "exceptions";
const blankLocation = (): LocationForm => ({
  name: "",
  address: "",
  timezone: "America/Argentina/Buenos_Aires",
  active: true,
});
const blankResource = (): ResourceForm => ({
  name: "",
  locationId: "",
  timezone: "America/Argentina/Buenos_Aires",
  capacity: 1,
  active: true,
});
const blankService = (): ServiceForm => ({
  name: "",
  resourceId: "",
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  slotGranularityMinutes: 15,
  minimumLeadMinutes: 0,
  maximumHorizonDays: 30,
  active: true,
});

export function SchedulingAutomationsPanel(props: Props): React.JSX.Element {
  const [configuration, setConfiguration] =
      useState<SchedulingConfiguration | null>(null),
    [tools, setTools] = useState<AssistantToolCatalog | null>(null),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [message, setMessage] = useState<string | null>(null),
    [tab, setTab] = useState<AutomationTab>("agenda");
  const [location, setLocation] = useState<LocationForm>(blankLocation),
    [resource, setResource] = useState<ResourceForm>(blankResource),
    [service, setService] = useState<ServiceForm>(blankService);
  const [availability, setAvailability] = useState({
      resourceId: "",
      weekday: 0,
      startTime: "09:00",
      endTime: "17:00",
    }),
    [exception, setException] = useState({
      resourceId: "",
      localDate: "",
      kind: "closed" as "open" | "closed",
      startTime: "09:00",
      endTime: "17:00",
    });
  const [editingLocationId, setEditingLocationId] = useState<string | null>(
      null,
    ),
    [editingResourceId, setEditingResourceId] = useState<string | null>(null),
    [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [proactivePolicy, setProactivePolicy] =
      useState<ProactiveActionPolicy | null>(null),
    [proactiveMessage, setProactiveMessage] = useState<string | null>(null),
    [proactiveSaving, setProactiveSaving] = useState(false),
    [confirmPolicy, setConfirmPolicy] = useState<boolean | null>(null);
  const operations = useRef(new Map<string, string>()),
    scope = useRef(0);
  const canManage = props.capabilities.includes("company:manage");
  const clearLocation = (): void => {
    setEditingLocationId(null);
    setLocation(blankLocation());
  };
  const clearResource = (): void => {
    setEditingResourceId(null);
    setResource(blankResource());
  };
  const clearService = (): void => {
    setEditingServiceId(null);
    setService(blankService());
  };
  const resetScope = (): void => {
    setConfiguration(null);
    setTools(null);
    setMessage(null);
    setSaving(false);
    setProactivePolicy(null);
    setProactiveMessage(null);
    setProactiveSaving(false);
    setConfirmPolicy(null);
    clearLocation();
    clearResource();
    clearService();
    setAvailability({
      resourceId: "",
      weekday: 0,
      startTime: "09:00",
      endTime: "17:00",
    });
    setException({
      resourceId: "",
      localDate: "",
      kind: "closed",
      startTime: "09:00",
      endTime: "17:00",
    });
    operations.current.clear();
  };
  const load = async (signal?: AbortSignal): Promise<void> => {
    if (!props.workspaceId || !props.companyId) return;
    const token = scope.current,
      workspaceId = props.workspaceId,
      companyId = props.companyId,
      profileId = props.profileId;
    setLoading(true);
    try {
      const [next, catalog] = await Promise.all([
        atlasApi.getSchedulingConfiguration(workspaceId, companyId, signal),
        atlasApi.getAssistantToolCatalog(
          workspaceId,
          companyId,
          profileId,
          signal,
        ),
      ]);
      if (token === scope.current && !signal?.aborted) {
        setConfiguration(next);
        setTools(catalog);
      }
    } catch (error) {
      if (
        token === scope.current &&
        !signal?.aborted &&
        (error as { name?: string }).name !== "AbortError"
      )
        setMessage("No pudimos cargar las automatizaciones. Intentá recargar.");
    } finally {
      if (token === scope.current && !signal?.aborted) setLoading(false);
    }
  };
  useEffect(() => {
    scope.current += 1;
    resetScope();
    if (!props.workspaceId || !props.companyId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [props.workspaceId, props.companyId, props.profileId]);
  useEffect(() => {
    if (!props.workspaceId || !props.companyId) return;
    const controller = new AbortController(),
      token = scope.current;
    void atlasApi
      .getProactiveActionPolicy(
        props.workspaceId,
        props.companyId,
        controller.signal,
      )
      .then((policy) => {
        if (token === scope.current && !controller.signal.aborted)
          setProactivePolicy(policy);
      })
      .catch((error) => {
        if (
          token === scope.current &&
          !controller.signal.aborted &&
          (error as { name?: string }).name !== "AbortError"
        )
          setProactiveMessage("No pudimos cargar la política de seguimientos.");
      });
    return () => controller.abort();
  }, [props.workspaceId, props.companyId]);
  const saveProactivePolicy = async (enabled: boolean): Promise<void> => {
    if (
      !props.workspaceId ||
      !props.companyId ||
      !proactivePolicy ||
      !canManage
    )
      return;
    const payload = { enabled, expectedVersion: proactivePolicy.version },
      signature = `proactive-policy:${JSON.stringify(payload)}`,
      operationId = operations.current.get(signature) ?? crypto.randomUUID();
    operations.current.set(signature, operationId);
    setProactiveSaving(true);
    setProactiveMessage(null);
    try {
      const policy = await atlasApi.updateProactiveActionPolicy(
        props.csrf,
        props.workspaceId,
        props.companyId,
        { operationId, ...payload },
      );
      operations.current.delete(signature);
      setProactivePolicy(policy);
      setProactiveMessage("La política de seguimientos se guardó.");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setProactiveMessage(
          "La política cambió en otra sesión. Recargamos el estado actual.",
        );
        const policy = await atlasApi.getProactiveActionPolicy(
          props.workspaceId,
          props.companyId,
        );
        setProactivePolicy(policy);
      } else
        setProactiveMessage(
          "No pudimos guardar la política. Podés reintentar sin cambiarla.",
        );
    } finally {
      setProactiveSaving(false);
      setConfirmPolicy(null);
    }
  };
  const execute = async (
    operation: Operation,
    payload: Record<string, unknown>,
  ): Promise<boolean> => {
    if (!props.workspaceId || !props.companyId || !configuration || !canManage)
      return false;
    const signature = `${operation}:${JSON.stringify(payload)}`;
    let operationId = operations.current.get(signature);
    if (!operationId) {
      operationId = crypto.randomUUID();
      operations.current.set(signature, operationId);
    }
    setSaving(true);
    setMessage(null);
    try {
      await atlasApi.mutateSchedulingConfiguration(
        props.csrf,
        props.workspaceId,
        props.companyId,
        {
          operationId,
          expectedVersion: configuration.aggregateVersion,
          operation,
          payload,
        },
      );
      operations.current.delete(signature);
      setMessage("Configuración guardada.");
      await load();
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setMessage(
          "La configuración cambió en otra sesión. Recargamos los datos antes de volver a intentar.",
        );
        await load();
      } else
        setMessage(
          "No pudimos guardar los cambios. Podés reintentar sin cambiar los datos.",
        );
      return false;
    } finally {
      setSaving(false);
    }
  };
  const editLocation = (id: string): void => {
    const item = configuration?.locations.find((value) => value.id === id);
    if (!item) {
      setMessage(
        "La ubicación que estabas editando ya no existe. Recargá la configuración.",
      );
      clearLocation();
      return;
    }
    setEditingLocationId(item.id);
    setLocation({
      name: item.name,
      address: item.address ?? "",
      timezone: item.timezone,
      active: item.active,
    });
  };
  const editResource = (id: string): void => {
    const item = configuration?.resources.find((value) => value.id === id);
    if (!item) {
      setMessage(
        "El recurso que estabas editando ya no existe. Recargá la configuración.",
      );
      clearResource();
      return;
    }
    setEditingResourceId(item.id);
    setResource({
      name: item.name,
      locationId: item.location_id ?? "",
      timezone: item.timezone,
      capacity: item.capacity,
      active: item.active,
    });
  };
  const editService = (id: string): void => {
    const item = configuration?.services.find((value) => value.id === id);
    if (!item) {
      setMessage(
        "El servicio que estabas editando ya no existe. Recargá la configuración.",
      );
      clearService();
      return;
    }
    setEditingServiceId(item.id);
    setService({
      name: item.name,
      resourceId: item.resource_id,
      durationMinutes: item.duration_minutes,
      bufferBeforeMinutes: item.buffer_before_minutes,
      bufferAfterMinutes: item.buffer_after_minutes,
      slotGranularityMinutes: item.slot_granularity_minutes,
      minimumLeadMinutes: item.minimum_lead_minutes,
      maximumHorizonDays: item.maximum_horizon_days,
      active: item.active,
    });
  };
  const tool = tools?.tools.find(
    (item) =>
      item.id.includes("scheduling") ||
      item.capabilityId.includes("scheduling"),
  );
  const availabilityWindows =
    configuration?.weeklyWorkingWindows
      .filter(
        (window) =>
          window.resource_id === availability.resourceId &&
          window.weekday !== availability.weekday,
      )
      .map((window) => ({
        weekday: window.weekday,
        startTime: window.start_time,
        endTime: window.end_time,
      })) ?? [];
  return (
    <section
      className="authenticated-section scheduling-automations"
      data-tab={tab}
      aria-busy={loading || saving}
    >
      <header className="section-heading">
        <div>
          <p className="atlas-eyebrow">Automatizaciones</p>
          <h2>Agenda y disponibilidad</h2>
          <p>
            Esta configuración pertenece a toda la empresa. No activa reservas
            públicas, calendario externo ni recordatorios.
          </p>
        </div>
      </header>
      <div className="scheduling-split-layout">
        <aside className="scheduling-master-rail" aria-label="Secciones de automatizaciones">
          <nav className="scheduling-master-nav">
            {[
              { id: "agenda", label: "Agenda" },
              { id: "followups", label: "Seguimientos" },
              { id: "locations", label: "Ubicaciones" },
              { id: "resources", label: "Recursos" },
              { id: "services", label: "Servicios" },
              { id: "availability", label: "Disponibilidad" },
              { id: "exceptions", label: "Excepciones" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                className={`scheduling-master-nav__item ${tab === item.id ? "is-active" : ""}`}
                onClick={() => setTab(item.id as AutomationTab)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="scheduling-detail-plane">
          {loading && <LoadingState title="Cargando configuración..." />}
          {message && (
            <Alert
              tone={
                message.startsWith("Configuración guardada") ? "success" : "danger"
              }
            >
              {message}
            </Alert>
          )}
          {configuration && (
            <>
              {tab === "agenda" && (
                <div className="scheduling-section">
                  <Readiness configuration={configuration} />
                  <div className="scheduling-tool-card">
                    <h3>Capacidad del asistente</h3>
                    <p>
                      {tool?.enabled
                        ? "El asistente tiene la capacidad de agenda habilitada."
                        : "La preparación de la empresa no habilita por sí misma la capacidad del asistente."}
                    </p>
                    {!tool?.enabled && (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          props.onNavigate(
                            `/companies/${props.companyId}/assistant/${props.profileId}/capabilities`,
                          )
                        }
                      >
                        Revisar capacidades
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {tab === "followups" && (
                <div className="scheduling-section">
                  <h3>Seguimientos proactivos</h3>
                  <p>
                    Esta política pertenece a la empresa, no a un asistente. Atlas
                    puede programar un único seguimiento compatible por WhatsApp según
                    las reglas y ventana de servicio existentes.
                  </p>
                  <p>
                    Una conversación que requiere atención sigue con Atlas activo; al
                    tomar control humano, el seguimiento se suprime. No hay campañas,
                    recurrencias ni destinatarios alternativos.
                  </p>
                  {proactivePolicy ? (
                    <>
                      <StatusBadge
                        tone={proactivePolicy.enabled ? "success" : "warning"}
                      >
                        {proactivePolicy.enabled
                          ? "Los seguimientos proactivos están habilitados."
                          : "Los seguimientos proactivos están deshabilitados."}
                      </StatusBadge>
                      {canManage ? (
                        <Button
                          variant="secondary"
                          disabled={proactiveSaving}
                          onClick={() => setConfirmPolicy(!proactivePolicy.enabled)}
                        >
                          {proactivePolicy.enabled
                            ? "Deshabilitar seguimientos"
                            : "Habilitar seguimientos"}
                        </Button>
                      ) : (
                        <p className="state-copy">
                          Podés consultar esta política, pero no modificarla.
                        </p>
                      )}
                    </>
                  ) : (
                    <LoadingState title="Cargando política de seguimientos..." />
                  )}
                  {proactiveMessage && (
                    <Alert
                      tone={
                        proactiveMessage.startsWith(
                          "La política de seguimientos se guardó",
                        )
                          ? "success"
                          : "danger"
                      }
                    >
                      {proactiveMessage}
                    </Alert>
                  )}
                  <ConfirmDialog
                    cancelLabel="Cancelar"
                    confirmDisabled={proactiveSaving}
                    confirmLabel="Confirmar"
                    confirmVariant="primary"
                    description={
                      confirmPolicy
                        ? "Habilitá los seguimientos proactivos para esta empresa."
                        : "Deshabilitá los seguimientos proactivos para esta empresa."
                    }
                    open={confirmPolicy !== null}
                    role="dialog"
                    title="Confirmar cambio"
                    onCancel={() => setConfirmPolicy(null)}
                    onConfirm={() => {
                      if (confirmPolicy !== null)
                        void saveProactivePolicy(confirmPolicy);
                    }}
                  />
                </div>
              )}

              {tab === "locations" && (
                <div className="scheduling-section">
                  <h3>Ubicaciones</h3>
                  <ul>
                    {configuration.locations.map((item) => (
                      <li key={item.id}>
                        {item.name} · {item.address ?? "Sin dirección"} ·{" "}
                        {item.timezone} · {item.active ? "Activa" : "Inactiva"}{" "}
                        {canManage && (
                          <Button
                            variant="quiet"
                            onClick={() => editLocation(item.id)}
                          >
                            Editar ubicación
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {canManage && (
                    <form className="automation-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const payload = editingLocationId
                          ? {
                              locationId: editingLocationId,
                              name: location.name,
                              address: location.address || null,
                              timezone: location.timezone,
                              active: location.active,
                            }
                          : {
                              name: location.name,
                              address: location.address || null,
                              timezone: location.timezone,
                            };
                        void execute(
                          editingLocationId ? "update_location" : "create_location",
                          payload,
                        ).then((saved) => {
                          if (saved) clearLocation();
                        });
                      }}
                    >
                      <h4>
                        {editingLocationId ? "Editar ubicación" : "Agregar ubicación"}
                      </h4>
                      <Text
                        label="Nombre de ubicación"
                        value={location.name}
                        set={(value) => setLocation({ ...location, name: value })}
                      />
                      <Text
                        label="Dirección"
                        value={location.address}
                        set={(value) => setLocation({ ...location, address: value })}
                      />
                      <Text
                        label="Zona horaria"
                        value={location.timezone}
                        set={(value) => setLocation({ ...location, timezone: value })}
                      />
                      <Check
                        label="Ubicación activa"
                        value={location.active}
                        set={(value) => setLocation({ ...location, active: value })}
                      />
                      <Button disabled={saving}>Guardar ubicación</Button>
                      {editingLocationId && (
                        <Button variant="secondary" onClick={clearLocation}>
                          Cancelar edición
                        </Button>
                      )}
                    </form>
                  )}
                </div>
              )}

              {tab === "resources" && (
                <div className="scheduling-section">
                  <h3>Recursos</h3>
                  <ul>
                    {configuration.resources.map((item) => (
                      <li key={item.id}>
                        {item.name} · {item.timezone} · capacidad {item.capacity}{" "}
                        {canManage && (
                          <button
                            type="button"
                            className="button button--quiet"
                            onClick={() => editResource(item.id)}
                          >
                            Editar recurso
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {canManage && (
                    <form className="automation-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const payload = {
                          name: resource.name,
                          locationId: resource.locationId || null,
                          timezone: resource.timezone,
                          capacity: resource.capacity,
                          active: resource.active,
                        };
                        void execute(
                          editingResourceId ? "update_resource" : "create_resource",
                          editingResourceId
                            ? { resourceId: editingResourceId, ...payload }
                            : payload,
                        ).then((saved) => {
                          if (saved) clearResource();
                        });
                      }}
                    >
                      <h4>
                        {editingResourceId ? "Editar recurso" : "Agregar recurso"}
                      </h4>
                      <Text
                        label="Nombre de recurso"
                        value={resource.name}
                        set={(value) => setResource({ ...resource, name: value })}
                      />
                      <label className="ds-field">
                        Ubicación
                        <Select
                          value={resource.locationId}
                          onChange={(event) =>
                            setResource({
                              ...resource,
                              locationId: event.target.value,
                            })
                          }
                        >
                          <option value="">Sin ubicación</option>
                          {configuration.locations.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </Select>
                      </label>
                      <Text
                        label="Zona horaria del recurso"
                        value={resource.timezone}
                        set={(value) => setResource({ ...resource, timezone: value })}
                      />
                      <NumberField
                        label="Capacidad"
                        value={resource.capacity}
                        set={(value) => setResource({ ...resource, capacity: value })}
                      />
                      <Check
                        label="Recurso activo"
                        value={resource.active}
                        set={(value) => setResource({ ...resource, active: value })}
                      />
                      <Button disabled={saving}>Guardar recurso</Button>
                      {editingResourceId && (
                        <Button variant="secondary" onClick={clearResource}>
                          Cancelar edición
                        </Button>
                      )}
                    </form>
                  )}
                </div>
              )}

              {tab === "services" && (
                <div className="scheduling-section">
                  <h3>Servicios</h3>
                  <ul>
                    {configuration.services.map((item) => (
                      <li key={item.id}>
                        {item.name} · {item.duration_minutes} min{" "}
                        {canManage && (
                          <Button
                            variant="quiet"
                            onClick={() => editService(item.id)}
                          >
                            Editar servicio
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {canManage && (
                    <form className="automation-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const payload = {
                          resourceId: service.resourceId,
                          name: service.name,
                          durationMinutes: service.durationMinutes,
                          bufferBeforeMinutes: service.bufferBeforeMinutes,
                          bufferAfterMinutes: service.bufferAfterMinutes,
                          slotGranularityMinutes: service.slotGranularityMinutes,
                          minimumLeadMinutes: service.minimumLeadMinutes,
                          maximumHorizonDays: service.maximumHorizonDays,
                          active: service.active,
                        };
                        void execute(
                          editingServiceId ? "update_service" : "create_service",
                          editingServiceId
                            ? { serviceId: editingServiceId, ...payload }
                            : payload,
                        ).then((saved) => {
                          if (saved) clearService();
                        });
                      }}
                    >
                      <h4>
                        {editingServiceId ? "Editar servicio" : "Agregar servicio"}
                      </h4>
                      <Text
                        label="Nombre de servicio"
                        value={service.name}
                        set={(value) => setService({ ...service, name: value })}
                      />
                      <label className="ds-field">
                        Recurso
                        <Select
                          required
                          value={service.resourceId}
                          onChange={(event) =>
                            setService({ ...service, resourceId: event.target.value })
                          }
                        >
                          <option value="">Elegí un recurso</option>
                          {configuration.resources.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </Select>
                      </label>
                      <NumberField
                        label="Duración (minutos)"
                        value={service.durationMinutes}
                        set={(value) =>
                          setService({ ...service, durationMinutes: value })
                        }
                      />
                      <NumberField
                        label="Buffer antes"
                        value={service.bufferBeforeMinutes}
                        set={(value) =>
                          setService({ ...service, bufferBeforeMinutes: value })
                        }
                      />
                      <NumberField
                        label="Buffer después"
                        value={service.bufferAfterMinutes}
                        set={(value) =>
                          setService({ ...service, bufferAfterMinutes: value })
                        }
                      />
                      <NumberField
                        label="Granularidad"
                        value={service.slotGranularityMinutes}
                        set={(value) =>
                          setService({ ...service, slotGranularityMinutes: value })
                        }
                      />
                      <NumberField
                        label="Anticipación mínima"
                        value={service.minimumLeadMinutes}
                        set={(value) =>
                          setService({ ...service, minimumLeadMinutes: value })
                        }
                      />
                      <NumberField
                        label="Horizonte máximo"
                        value={service.maximumHorizonDays}
                        set={(value) =>
                          setService({ ...service, maximumHorizonDays: value })
                        }
                      />
                      <Check
                        label="Servicio activo"
                        value={service.active}
                        set={(value) => setService({ ...service, active: value })}
                      />
                      <Button disabled={saving}>Guardar servicio</Button>
                      {editingServiceId && (
                        <Button variant="secondary" onClick={clearService}>
                          Cancelar edición
                        </Button>
                      )}
                    </form>
                  )}
                </div>
              )}

              {tab === "availability" && (
                <div className="scheduling-section">
                  <h3>Disponibilidad semanal</h3>
                  {canManage && (
                    <form className="automation-form automation-form--schedule"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void execute("replace_weekly_availability", {
                          resourceId: availability.resourceId,
                          windows: [
                            ...availabilityWindows,
                            {
                              weekday: availability.weekday,
                              startTime: availability.startTime,
                              endTime: availability.endTime,
                            },
                          ],
                        });
                      }}
                    >
                      <ResourceSelect
                        label="Recurso para disponibilidad"
                        value={availability.resourceId}
                        resources={configuration.resources}
                        set={(value) =>
                          setAvailability({ ...availability, resourceId: value })
                        }
                      />
                      <WeekdaySelect
                        value={availability.weekday}
                        set={(value) =>
                          setAvailability({ ...availability, weekday: value })
                        }
                      />
                      <Text
                        label="Hora de inicio"
                        value={availability.startTime}
                        set={(value) =>
                          setAvailability({ ...availability, startTime: value })
                        }
                        type="time"
                      />
                      <Text
                        label="Hora de fin"
                        value={availability.endTime}
                        set={(value) =>
                          setAvailability({ ...availability, endTime: value })
                        }
                        type="time"
                      />
                      <Button disabled={saving}>Guardar disponibilidad</Button>
                    </form>
                  )}
                </div>
              )}

              {tab === "exceptions" && (
                <div className="scheduling-section">
                  <h3>Excepciones de fecha</h3>
                  <ul>
                    {configuration.dateExceptions.map((item) => (
                      <li key={item.id}>
                        {item.local_date} · {item.kind}{" "}
                        {canManage && (
                          <Button
                            variant="quiet"
                            onClick={() =>
                              void execute("remove_date_exception", {
                                exceptionId: item.id,
                              })
                            }
                          >
                            Quitar excepción
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {canManage && (
                    <form className="automation-form automation-form--schedule"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void execute("add_date_exception", {
                          resourceId: exception.resourceId,
                          localDate: exception.localDate,
                          kind: exception.kind,
                          ...(exception.kind === "open"
                            ? {
                                startTime: exception.startTime,
                                endTime: exception.endTime,
                              }
                            : {}),
                        });
                      }}
                    >
                      <ResourceSelect
                        label="Recurso para excepción"
                        value={exception.resourceId}
                        resources={configuration.resources}
                        set={(value) =>
                          setException({ ...exception, resourceId: value })
                        }
                      />
                      <Text
                        label="Fecha"
                        value={exception.localDate}
                        set={(value) =>
                          setException({ ...exception, localDate: value })
                        }
                        type="date"
                      />
                      <label className="ds-field">
                        Tipo
                        <Select
                          value={exception.kind}
                          onChange={(event) =>
                            setException({
                              ...exception,
                              kind: event.target.value as "open" | "closed",
                            })
                          }
                        >
                          <option value="closed">Cerrado</option>
                          <option value="open">Abierto</option>
                        </Select>
                      </label>
                      {exception.kind === "open" && (
                        <>
                          <Text
                            label="Inicio de excepción"
                            value={exception.startTime}
                            set={(value) =>
                              setException({ ...exception, startTime: value })
                            }
                            type="time"
                          />
                          <Text
                            label="Fin de excepción"
                            value={exception.endTime}
                            set={(value) =>
                              setException({ ...exception, endTime: value })
                            }
                            type="time"
                          />
                        </>
                      )}
                      <Button disabled={saving}>Agregar excepción</Button>
                    </form>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
function Readiness({
  configuration,
}: {
  configuration: SchedulingConfiguration;
}): React.JSX.Element {
  return (
    <div className="scheduling-section-block">
      <h3>Qué puede usar Atlas ahora</h3>
      <p>
        {configuration.readiness.state === "not_configured"
          ? "Aún no hay agenda configurada."
          : configuration.readiness.state === "minimal"
            ? "La agenda está iniciada; todavía faltan servicios activos y disponibilidad semanal."
            : "La disponibilidad interna está configurada y puede usarse dentro de la empresa."}
      </p>
    </div>
  );
}
function Text({
  label,
  value,
  set,
  type = "text",
}: {
  label: string;
  value: string;
  set: (value: string) => void;
  type?: string;
}): React.JSX.Element {
  return (
    <label className="ds-field">
      {label}
      <Input
        type={type}
        value={value}
        onChange={(event) => set(event.target.value)}
        required={label !== "Dirección"}
      />
    </label>
  );
}
function NumberField({
  label,
  value,
  set,
}: {
  label: string;
  value: number;
  set: (value: number) => void;
}): React.JSX.Element {
  return (
    <label className="ds-field">
      {label}
      <Input
        type="number"
        min="0"
        value={value}
        onChange={(event) => set(Number(event.target.value))}
        required
      />
    </label>
  );
}
function Check({
  label,
  value,
  set,
}: {
  label: string;
  value: boolean;
  set: (value: boolean) => void;
}): React.JSX.Element {
  return (
    <label className="automation-check">
      <Checkbox
        checked={value}
        onChange={(event) => set(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
function WeekdaySelect({
  value,
  set,
}: {
  value: number;
  set: (value: number) => void;
}): React.JSX.Element {
  return (
    <label className="ds-field">
      Día de la semana
      <Select
        value={value}
        onChange={(event) => set(Number(event.target.value))}
      >
        {[
          "Lunes",
          "Martes",
          "Miércoles",
          "Jueves",
          "Viernes",
          "Sábado",
          "Domingo",
        ].map((day, index) => (
          <option key={day} value={index}>
            {day}
          </option>
        ))}
      </Select>
    </label>
  );
}
function ResourceSelect({
  label,
  value,
  resources,
  set,
}: {
  label: string;
  value: string;
  resources: SchedulingConfiguration["resources"];
  set: (value: string) => void;
}): React.JSX.Element {
  return (
    <label className="ds-field">
      {label}
      <Select
        required
        value={value}
        onChange={(event) => set(event.target.value)}
      >
        <option value="">Elegí un recurso</option>
        {resources.map((resource) => (
          <option key={resource.id} value={resource.id}>
            {resource.name}
          </option>
        ))}
      </Select>
    </label>
  );
}
