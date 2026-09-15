import type { PilotReadinessCheckId, PilotReadinessClassification, PilotReadinessStatus } from "../../onboarding/domain/pilotReadiness.js";
import type { PilotReadinessService } from "../../onboarding/services/pilotReadinessService.js";
import type { PlatformAdministrationRepository } from "../../repositories/platformAdministrationRepository.js";

export interface PlatformPilotReadinessIssue { readonly id:PilotReadinessCheckId; readonly required:boolean; readonly status:Exclude<PilotReadinessStatus,"complete"|"not_applicable">; readonly owner:"customer"|"platform"|"external_provider"; readonly reasonCode:string; }
export type PlatformPilotReadinessCompany = { readonly companyId:number; readonly companyName:string; readonly state:"available"; readonly overall:"not_ready"|"pilot_ready"; readonly classification:PilotReadinessClassification; readonly evaluatedAt:string; readonly issues:readonly PlatformPilotReadinessIssue[] }|{ readonly companyId:number; readonly companyName:string; readonly state:"unavailable" };
export interface PlatformPilotReadinessProjection { readonly aggregate:{readonly totalCompanies:number;readonly pilotReady:number;readonly notReady:number;readonly unavailable:number}; readonly companies:readonly PlatformPilotReadinessCompany[]; }

export class PlatformPilotReadinessService {
  public constructor(private readonly repository:PlatformAdministrationRepository,private readonly readiness:PilotReadinessService) {}
  public async workspace(publicId:unknown):Promise<PlatformPilotReadinessProjection>{
    if(typeof publicId!=="string")throw new Error("Workspace not found.");
    const context=this.repository.workspaceContext(publicId);if(!context)throw new Error("Workspace not found.");
    const companies=await Promise.all(this.repository.readinessCompanies(context).map(async company=>{
      try{const assessment=await this.readiness.get(context,company.id);const issues=assessment.checks.filter(check=>check.status!=="complete"&&check.status!=="not_applicable").map(check=>Object.freeze({id:check.id,required:check.required,status:check.status as PlatformPilotReadinessIssue["status"],owner:check.owner!,reasonCode:check.reasonCode!}));return Object.freeze({companyId:company.id,companyName:company.name,state:"available" as const,overall:assessment.overall,classification:assessment.classification,evaluatedAt:assessment.evaluatedAt,issues:Object.freeze(issues)});
      }catch{return Object.freeze({companyId:company.id,companyName:company.name,state:"unavailable" as const});}
    }));
    const pilotReady=companies.filter(company=>company.state==="available"&&company.overall==="pilot_ready").length,unavailable=companies.filter(company=>company.state==="unavailable").length;
    return Object.freeze({aggregate:Object.freeze({totalCompanies:companies.length,pilotReady,notReady:companies.length-pilotReady-unavailable,unavailable}),companies:Object.freeze(companies)});
  }
}
