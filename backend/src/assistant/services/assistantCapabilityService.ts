import type { Clock } from "../../identity/application/ports.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import { AssistantCapabilityCatalog, type AssistantCapabilityKey } from "../domain/assistantCapability.js";
import type { AssistantProfileCapabilityRepositoryPort } from "../application/toolContracts.js";

export class AssistantCapabilityValidationError extends Error {}
export class AssistantCapabilityNotFoundError extends Error {}
export class AssistantCapabilityService {
  public constructor(private readonly catalog: AssistantCapabilityCatalog, private readonly repository: AssistantProfileCapabilityRepositoryPort, private readonly clock: Clock) {}
  public async list(context: WorkspaceContext, companyIdValue: unknown, profileIdValue: unknown): Promise<readonly AssistantCapabilityKey[]> { const companyId=company(companyIdValue),assistantProfileId=profile(profileIdValue);if(!await this.repository.existsForProfile(context,companyId,assistantProfileId))throw new AssistantCapabilityNotFoundError("Assistant Profile was not found.");return this.repository.listForProfile(context,companyId,assistantProfileId); }
  public async replace(context: WorkspaceContext, companyIdValue: unknown, profileIdValue: unknown, input: unknown, actorUserId: string): Promise<readonly AssistantCapabilityKey[]> {
    const companyId=company(companyIdValue), assistantProfileId=profile(profileIdValue);
    if (!input || typeof input!=="object" || Array.isArray(input) || Object.keys(input).length!==1 || !Array.isArray((input as Record<string,unknown>).capabilities)) throw new AssistantCapabilityValidationError("Capabilities input is invalid.");
    const values=(input as {capabilities:unknown[]}).capabilities;
    if (values.some(value=>typeof value!=="string")) throw new AssistantCapabilityValidationError("Capabilities input is invalid.");
    if (values.length===0) throw new AssistantCapabilityValidationError("At least one Assistant capability is required.");
    let capabilities: AssistantCapabilityKey[];
    try { capabilities=values.map(value=>this.catalog.require(value as string)); } catch { throw new AssistantCapabilityValidationError("Assistant capability is unknown."); }
    if(new Set(capabilities).size!==capabilities.length) throw new AssistantCapabilityValidationError("Assistant capabilities are duplicated.");
    if(!await this.repository.replaceForProfile(context,companyId,assistantProfileId,capabilities,actorUserId,this.clock.now())) throw new AssistantCapabilityNotFoundError("Assistant Profile was not found.");
    return Object.freeze([...capabilities].sort());
  }
}
function company(value:unknown):number{const parsed=typeof value==="string"&&/^\d+$/.test(value)?Number(value):typeof value==="number"?value:NaN;if(!Number.isSafeInteger(parsed)||parsed<1)throw new AssistantCapabilityValidationError("Company ID is invalid.");return parsed;}
function profile(value:unknown):string{if(typeof value!=="string"||!/^asp_[a-z0-9]{32}$/i.test(value))throw new AssistantCapabilityValidationError("Assistant Profile ID is invalid.");return value;}
