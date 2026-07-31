import { useEffect, useRef, useState } from "react";
import { ApiError, atlasApi } from "../api/atlasApi";
import { Button, Skeleton, Stack, Surface } from "../design-system/primitives";
import { useI18n } from "../i18n/I18nContext";
import type { KnowledgeIngestionResponse } from "../types/api";

const TIMEOUT_MS = 30_000;
function websiteName(url: string): string { return `Website: ${new URL(url).hostname}`; }
function errorMessage(error: unknown, t: ReturnType<typeof useI18n>["t"]): string {
  if (error instanceof DOMException && error.name === "AbortError") return t("websiteKnowledge.error.timeout");
  if (error instanceof ApiError && error.code === "knowledge_source_name_conflict") return t("websiteKnowledge.error.duplicate");
  if (error instanceof ApiError && error.code === "invalid_public_url") return t("websiteKnowledge.error.invalid");
  if (error instanceof ApiError && error.code === "knowledge_extraction_unavailable") return t("websiteKnowledge.error.unreachable");
  return t("websiteKnowledge.error.unavailable");
}

export function WebsiteKnowledgeStep({ csrf, workspaceId, companyId, onContinue }: { readonly csrf: string; readonly workspaceId: string; readonly companyId: number; readonly onContinue: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const [url, setUrl] = useState(""), [processing, setProcessing] = useState(false), [error, setError] = useState<string | null>(null), [result, setResult] = useState<KnowledgeIngestionResponse | null>(null);
  const heading = useRef<HTMLHeadingElement>(null), active = useRef<AbortController | null>(null);
  useEffect(() => { heading.current?.focus(); return () => active.current?.abort(); }, [result]);
  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    let parsed: URL;
    try { parsed = new URL(url); if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error(); }
    catch { setError(t("websiteKnowledge.error.invalid")); return; }
    const controller = new AbortController(); active.current?.abort(); active.current = controller; const timeout = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
    setProcessing(true); setError(null);
    try { setResult(await atlasApi.createUrlKnowledge(csrf, workspaceId, companyId, websiteName(parsed.href), parsed.href, controller.signal)); }
    catch (cause: unknown) { if (!controller.signal.aborted || active.current === controller) setError(errorMessage(cause, t)); }
    finally { window.clearTimeout(timeout); if (active.current === controller) { active.current = null; setProcessing(false); } }
  };
  if (result) return <Surface className="guided-registration" tone="raised"><Stack gap="4"><h1 ref={heading} tabIndex={-1}>{t("websiteKnowledge.success.title")}</h1><p role="status" aria-live="polite">{t("websiteKnowledge.success.description")}</p><dl><dt>{t("websiteKnowledge.metadata.source")}</dt><dd>{result.source.name}</dd><dt>{t("websiteKnowledge.metadata.status")}</dt><dd>{result.revision.status}</dd></dl><Button onClick={onContinue}>{t("websiteKnowledge.continue")}</Button></Stack></Surface>;
  return <Surface className="guided-registration" tone="raised"><form onSubmit={(event) => void submit(event)}><Stack gap="4"><h1 ref={heading} tabIndex={-1}>{t("websiteKnowledge.title")}</h1><p>{t("websiteKnowledge.description")}</p><label>{t("websiteKnowledge.url")}<input autoComplete="url" autoFocus disabled={processing} inputMode="url" required type="url" value={url} onChange={(event) => setUrl(event.target.value)} onInvalid={() => setError(t("websiteKnowledge.error.invalid"))} /></label>{processing && <Skeleton label={t("websiteKnowledge.processing")} />}{error && <p role="alert">{error}</p>}<Button type="submit" disabled={processing}>{t(processing ? "websiteKnowledge.processing" : "websiteKnowledge.submit")}</Button></Stack></form></Surface>;
}
