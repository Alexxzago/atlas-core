import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AtlasAgent } from "./agents/atlas.js";
import { createChatController } from "./controllers/chatController.js";
import {
  createCompanyController,
  createDeleteCompanyController,
  createGetCompanyController,
  createListCompaniesController,
  createUpdateCompanyController,
} from "./controllers/companyController.js";
import { createKnowledgeController } from "./controllers/knowledgeController.js";
import { createOnboardingController } from "./controllers/onboarding.js";
import { createScrapeController } from "./controllers/scrapeController.js";
import { createAuthenticationControllers, createPlatformBootstrapControllers, createRegistrationController, createResendVerificationController, createVerifyEmailController } from "./controllers/identityController.js";
import { database } from "./config/database.js";
import { DevelopmentVerificationDelivery, UnavailableVerificationDelivery } from "./identity/infrastructure/developmentVerificationDelivery.js";
import { ScryptPasswordProvider, SecureRandomProvider, Sha256CredentialEnrollmentHashProvider, Sha256SessionIdentifierProvider, Sha256VerificationHashProvider } from "./identity/infrastructure/securityProviders.js";
import { SystemClock } from "./identity/infrastructure/systemClock.js";
import { RegistrationService } from "./identity/services/registrationService.js";
import { ResendEmailVerificationService } from "./identity/services/resendEmailVerificationService.js";
import { VerifyEmailService } from "./identity/services/verifyEmailService.js";
import { SqliteAuthenticationTransaction, SqliteIdentityTransaction } from "./repositories/identityTransaction.js";
import { AuthenticationService } from "./identity/services/authenticationService.js";
import { createIdentityRouter } from "./routes/identity.js";
import { firecrawlProvider } from "./providers/firecrawl.js";
import { GeminiKnowledgeFactExtractor, geminiProvider } from "./providers/gemini.js";
import { companyRepository } from "./repositories/companyRepository.js";
import { knowledgeRepository } from "./repositories/knowledgeRepository.js";
import { workspaceRepository } from "./repositories/workspaceRepository.js";
import { FileMarkdownDebugStore } from "./repositories/markdownDebugRepository.js";
import { createChatRouter } from "./routes/chat.js";
import { createCompaniesRouter } from "./routes/companies.js";
import { createKnowledgeRouter } from "./routes/knowledge.js";
import { createScrapeRouter } from "./routes/scrape.js";
import { ChatService } from "./services/chatService.js";
import { CompanyService } from "./services/companyService.js";
import { KnowledgeService } from "./services/knowledgeService.js";
import { cleanMarkdown } from "./services/markdownCleaner.js";
import { OnboardingService } from "./services/onboardingService.js";
import { ScrapeService } from "./services/scrapeService.js";
import { createWorkspaceContext } from "./types/workspaceContext.js";
import {createWorkspaceAdministrationControllers}from"./controllers/workspaceAdministrationController.js";
import{createWorkspacesRouter}from"./routes/workspaces.js";
import{SqliteWorkspaceAdministrationTransaction}from"./repositories/workspaceAdministrationTransaction.js";
import{MembershipRepository}from"./repositories/workspaceAdministrationRepository.js";
import{DevelopmentInvitationDelivery,SecureInvitationProofProvider,UnavailableInvitationDelivery}from"./workspace/infrastructure/invitationProviders.js";
import{WorkspaceAdministrationService}from"./workspace/services/workspaceAdministrationService.js";
import{AuthorizationService}from"./workspace/services/authorizationService.js";
import{WorkspaceResolver}from"./workspace/services/workspaceResolver.js";
import{createAuthorizedCompaniesRouter}from"./routes/authorizedCompanies.js";
import{UserRepository}from"./repositories/userRepository.js";
import{AssistantProfileRepository}from"./repositories/assistantProfileRepository.js";
import{AssistantProfileService}from"./assistant/services/assistantProfileService.js";
import{createAssistantProfileController,createGetAssistantProfileController,createListAssistantProfilesController,createTransitionAssistantProfileController,createUpdateAssistantProfileController}from"./controllers/assistantProfileController.js";
import { AssistantPreviewService } from "./assistant/services/assistantPreviewService.js";
import { createAssistantPreviewController } from "./controllers/assistantPreviewController.js";
import { ExactRequestOriginPolicy } from "./identity/infrastructure/requestOriginPolicy.js";
import { CompanyKnowledgeRepository } from "./repositories/companyKnowledgeRepository.js";
import { KnowledgeService as FrozenKnowledgeService } from "./knowledge/services/knowledgeServices.js";
import { SecurePublicUrlProvider } from "./knowledge/infrastructure/publicUrlProvider.js";
import { WorkerPdfTextExtractor } from "./knowledge/infrastructure/pdfTextExtractor.js";
import { createCompanyKnowledgeControllers } from "./controllers/companyKnowledgeController.js";
import { createOperationalAssistantExecutionController } from "./controllers/operationalAssistantExecutionController.js";
import { InMemoryOperationalExecutionBudget } from "./assistant/application/operationalExecutionBudget.js";
import { OperationalAssistantExecutionService } from "./assistant/services/operationalAssistantExecutionService.js";
import type { AssistantExecutionPort } from "./assistant/application/assistantExecutionPort.js";
import type { AppRouters } from "./app.js";
import { smtpConfiguration, SmtpEmailDelivery } from "./providers/smtpEmailDelivery.js";
import { SqlitePlatformBootstrapTransaction } from "./repositories/platformBootstrapTransaction.js";
import { PlatformBootstrapService } from "./identity/services/platformBootstrapService.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workspaceContext = createWorkspaceContext(workspaceRepository.resolveDefault());
const agent = new AtlasAgent(geminiProvider);
const chatService = new ChatService(companyRepository, knowledgeRepository, agent);
const companyService = new CompanyService(companyRepository);
const knowledgeService = new KnowledgeService(knowledgeRepository);
const scrapeService = new ScrapeService(firecrawlProvider);
const identityTransaction = new SqliteIdentityTransaction(database);
const randomProvider = new SecureRandomProvider();
const verificationHashProvider = new Sha256VerificationHashProvider();
const identityClock = new SystemClock();
const production=process.env.NODE_ENV==="production";
if (production && (process.env.ATLAS_BOOTSTRAP_SECRET?.length ?? 0) < 32) throw new Error("Production requires ATLAS_BOOTSTRAP_SECRET with at least 32 characters.");
const deliverySelection = process.env.ATLAS_VERIFICATION_DELIVERY;
const useDevelopmentDelivery = !production && deliverySelection !== "smtp";
const smtpDelivery = useDevelopmentDelivery
  ? null
  : new SmtpEmailDelivery(smtpConfiguration());
const verificationDelivery = useDevelopmentDelivery
  ? new DevelopmentVerificationDelivery(process.env.NODE_ENV ?? "development", (message) => console.info(message))
  : smtpDelivery ?? new UnavailableVerificationDelivery();
const verificationOrigin = process.env.ATLAS_VERIFICATION_ORIGIN ?? "http://localhost:3000";
const verificationLifetimeMilliseconds = 24 * 60 * 60 * 1000;
const verificationCooldownMilliseconds = 60 * 1000;
const registrationService = new RegistrationService(identityTransaction, randomProvider, verificationHashProvider,
  identityClock, verificationDelivery, verificationOrigin, verificationLifetimeMilliseconds);
const resendVerificationService = new ResendEmailVerificationService(identityTransaction, randomProvider,
  verificationHashProvider, identityClock, verificationDelivery, verificationOrigin,
  verificationLifetimeMilliseconds, verificationCooldownMilliseconds);
const verifyEmailService = new VerifyEmailService(identityTransaction, verificationHashProvider, identityClock);
const authenticationService=new AuthenticationService(new SqliteAuthenticationTransaction(database),randomProvider,new Sha256CredentialEnrollmentHashProvider(),new ScryptPasswordProvider(),new Sha256SessionIdentifierProvider(),identityClock,verificationDelivery,verificationOrigin,process.env.NODE_ENV==="production");
const requestOriginPolicy=new ExactRequestOriginPolicy(production?[verificationOrigin]:[verificationOrigin,"http://localhost:5173"],production);
const authenticationControllers=createAuthenticationControllers(authenticationService,requestOriginPolicy);
const invitationDelivery=useDevelopmentDelivery?new DevelopmentInvitationDelivery(process.env.NODE_ENV??"development",message=>console.info(message)):smtpDelivery??new UnavailableInvitationDelivery();
const workspaceAdministrationService=new WorkspaceAdministrationService(new SqliteWorkspaceAdministrationTransaction(database),new SecureInvitationProofProvider(),identityClock,invitationDelivery,verificationOrigin);
const platformBootstrapService = new PlatformBootstrapService(new SqlitePlatformBootstrapTransaction(database), randomProvider,
  new ScryptPasswordProvider(), new Sha256SessionIdentifierProvider(), identityClock, process.env.ATLAS_BOOTSTRAP_SECRET ?? "");
const platformBootstrapControllers = createPlatformBootstrapControllers(platformBootstrapService, authenticationService);
export const authorizationService=new AuthorizationService(new MembershipRepository(database),workspaceRepository);
export const authenticatedWorkspaceResolver=new WorkspaceResolver(workspaceRepository);
const assistantProfileService=new AssistantProfileService(new AssistantProfileRepository(database),identityClock);
const companyKnowledgeService=new FrozenKnowledgeService(companyRepository,new CompanyKnowledgeRepository(database),new SecurePublicUrlProvider(),new WorkerPdfTextExtractor(),new GeminiKnowledgeFactExtractor(geminiProvider),identityClock);
const companyKnowledgeControllers=createCompanyKnowledgeControllers(companyKnowledgeService);
const onboardingService = new OnboardingService(companyRepository,knowledgeRepository,firecrawlProvider,geminiProvider,cleanMarkdown,new FileMarkdownDebugStore(resolve(repositoryRoot,"knowledge")),companyKnowledgeService);

export const chatRouter = createChatRouter(createChatController(chatService, workspaceContext));
export const companiesRouter = createCompaniesRouter({
  list: createListCompaniesController(companyService, workspaceContext),
  create: createCompanyController(companyService, workspaceContext),
  get: createGetCompanyController(companyService, workspaceContext),
  update: createUpdateCompanyController(companyService, workspaceContext),
  delete: createDeleteCompanyController(companyService, workspaceContext),
  onboard: createOnboardingController(onboardingService, workspaceContext),
});
export const knowledgeRouter = createKnowledgeRouter(createKnowledgeController(knowledgeService, workspaceContext));
export const scrapeRouter = createScrapeRouter(createScrapeController(scrapeService));
export const identityRouter = createIdentityRouter({
  register: createRegistrationController(registrationService),
  resend: createResendVerificationController(resendVerificationService),
  verify: createVerifyEmailController(verifyEmailService),
  bootstrapStatus: platformBootstrapControllers.status,
  platformBootstrap: platformBootstrapControllers.bootstrap,
  ...authenticationControllers,
});
export const workspacesRouter=createWorkspacesRouter(createWorkspaceAdministrationControllers(workspaceAdministrationService,authenticationService));
function createProductionAuthorizedCompaniesRouter(execution: AssistantExecutionPort) {
  const preview = new AssistantPreviewService(companyRepository, knowledgeRepository, new AssistantProfileRepository(database), execution);
  const operational = new OperationalAssistantExecutionService(companyRepository, knowledgeRepository, new AssistantProfileRepository(database), execution, new InMemoryOperationalExecutionBudget());
  return createAuthorizedCompaniesRouter({authentication:authenticationService,users:new UserRepository(database),authorization:authorizationService,resolver:authenticatedWorkspaceResolver,controllers:{list:context=>createListCompaniesController(companyService,context),create:context=>createCompanyController(companyService,context),get:context=>createGetCompanyController(companyService,context),update:context=>createUpdateCompanyController(companyService,context),delete:context=>createDeleteCompanyController(companyService,context),onboard:(context,actor)=>createOnboardingController(onboardingService,context,actor)},assistantControllers:{list:context=>createListAssistantProfilesController(assistantProfileService,context),create:context=>createAssistantProfileController(assistantProfileService,context),get:context=>createGetAssistantProfileController(assistantProfileService,context),update:context=>createUpdateAssistantProfileController(assistantProfileService,context),transition:context=>createTransitionAssistantProfileController(assistantProfileService,context),preview:context=>createAssistantPreviewController(preview,context),execution:context=>createOperationalAssistantExecutionController(operational,context)},knowledgeControllers:companyKnowledgeControllers});
}

export const authorizedCompaniesRouter = createProductionAuthorizedCompaniesRouter(agent);

export function createProductionAppRouters(execution: AssistantExecutionPort = agent): AppRouters {
  return { authorizedCompaniesRouter: createProductionAuthorizedCompaniesRouter(execution), chatRouter, companiesRouter, identityRouter, knowledgeRouter, scrapeRouter, workspacesRouter };
}
