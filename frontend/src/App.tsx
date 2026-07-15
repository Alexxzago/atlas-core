import { useCallback, useEffect, useMemo, useState } from "react";
import { atlasApi } from "./api/atlasApi";
import { CompanySidebar } from "./components/CompanySidebar";
import { CompanyWorkspace } from "./components/CompanyWorkspace";
import { PortalHeader } from "./components/PortalHeader";
import { useI18n } from "./i18n/I18nContext";
import { applyOnboardingFailure, replaceCompany, setCompanyStatus } from "./state/companyState";
import type { Company, CompanyInput, CompanyUpdate } from "./types/api";

export default function App(): React.JSX.Element {
  const { t } = useI18n();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadCompanies = useCallback(async (): Promise<void> => {
    setLoading(true); setError(false);
    try {
      const result = await atlasApi.listCompanies();
      setCompanies(result);
      setSelectedId((current) => result.some((company) => company.id === current) ? current : result[0]?.id ?? null);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadCompanies(); }, [loadCompanies]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  const selected = useMemo(() => companies.find((company) => company.id === selectedId) ?? null, [companies, selectedId]);
  const updateCompanyState = (updated: Company): void => setCompanies((current) => replaceCompany(current, updated));

  const createCompany = async (input: CompanyInput): Promise<Company> => {
    const created = await atlasApi.createCompany(input);
    setCompanies((current) => [created, ...current]); setSelectedId(created.id); setNotice(t("companies.createSuccess")); return created;
  };
  const updateCompany = async (input: CompanyUpdate): Promise<void> => {
    if (!selectedId) return;
    updateCompanyState(await atlasApi.updateCompany(selectedId, input));
  };
  const deleteCompany = async (): Promise<void> => {
    if (!selectedId) return;
    await atlasApi.deleteCompany(selectedId);
    const remaining = companies.filter((company) => company.id !== selectedId);
    setCompanies(remaining); setSelectedId(remaining[0]?.id ?? null); setNotice(t("companies.deleteSuccess"));
  };

  const markOnboardingStarted = (companyId: number): void => {
    setCompanies((current) => setCompanyStatus(current, companyId, "processing"));
  };

  const markOnboardingFailed = async (companyId: number): Promise<void> => {
    try {
      const refreshed = await atlasApi.getCompany(companyId);
      setCompanies((current) => applyOnboardingFailure(current, companyId, refreshed));
    } catch {
      setCompanies((current) => applyOnboardingFailure(current, companyId));
    }
  };

  return <div className="portal-shell"><PortalHeader />{notice && <div className="portal-notice inline-message inline-message--success" role="status">{notice}</div>}<CompanySidebar companies={companies} selectedId={selectedId} loading={loading} error={error} onSelect={setSelectedId} onCreate={createCompany} onRetry={() => void loadCompanies()} /><CompanyWorkspace company={selected} loading={loading} onUpdate={updateCompany} onDelete={deleteCompany} onOnboardingStart={markOnboardingStarted} onOnboardingComplete={updateCompanyState} onOnboardingFailure={markOnboardingFailed} /></div>;
}
