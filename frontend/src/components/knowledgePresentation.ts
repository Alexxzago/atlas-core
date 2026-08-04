import type { KnowledgePublication, KnowledgeSource } from "../types/api";

export type KnowledgeCustomerState = "processing" | "review" | "available" | "attention" | "archived";
export interface KnowledgeSourcePresentation { readonly state: KnowledgeCustomerState; readonly canUse: boolean; readonly action: "review" | "update" | "publish" | "none"; }

export function presentKnowledgeSource(source: KnowledgeSource, publication: KnowledgePublication | null): KnowledgeSourcePresentation {
  if (source.status === "archived") return { state: "archived", canUse: false, action: "none" };
  const revision = source.latestRevision;
  if (!revision || revision.status === "pending") return { state: "processing", canUse: false, action: "none" };
  if (revision.status === "failed") return { state: "attention", canUse: false, action: "update" };
  const published = publication?.sourceRevisionIds.includes(revision.id) ?? source.includedRevisionId === revision.id;
  return published ? { state: "available", canUse: true, action: "review" } : { state: "review", canUse: false, action: "publish" };
}
