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
import { createAuthenticationControllers, createPasswordResetControllers, createPlatformBootstrapControllers, createRegistrationController, createResendVerificationController, createVerifyEmailController } from "./controllers/identityController.js";
import { database } from "./config/database.js";
import { DevelopmentVerificationDelivery, UnavailableVerificationDelivery } from "./identity/infrastructure/developmentVerificationDelivery.js";
import { ScryptPasswordProvider, SecureRandomProvider, Sha256CredentialEnrollmentHashProvider, Sha256SessionIdentifierProvider, Sha256VerificationHashProvider } from "./identity/infrastructure/securityProviders.js";
import { SystemClock } from "./identity/infrastructure/systemClock.js";
import { RegistrationService } from "./identity/services/registrationService.js";
import { ResendEmailVerificationService } from "./identity/services/resendEmailVerificationService.js";
import { VerifyEmailService } from "./identity/services/verifyEmailService.js";
import { PasswordResetService } from "./identity/services/passwordResetService.js";
import { SqliteAuthenticationTransaction, SqliteIdentityTransaction } from "./repositories/identityTransaction.js";
import { AuthenticationService } from "./identity/services/authenticationService.js";
import { createIdentityRouter } from "./routes/identity.js";
import { firecrawlProvider } from "./providers/firecrawl.js";
import { GeminiKnowledgeFactExtractor, geminiProvider } from "./providers/gemini.js";
import { ManualTextKnowledgeFactExtractor } from "./knowledge/services/manualTextKnowledgeFactExtractor.js";
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
import { emailDeliveryMode } from "./providers/emailDeliveryMode.js";
import { ResendEmailDelivery, resendConfiguration } from "./providers/resendEmailDelivery.js";
import { GoogleAppsScriptEmailDelivery, googleAppsScriptConfiguration } from "./providers/googleAppsScriptEmailDelivery.js";
import { SqlitePlatformBootstrapTransaction } from "./repositories/platformBootstrapTransaction.js";
import { PlatformBootstrapService } from "./identity/services/platformBootstrapService.js";
import { ConversationRepository } from "./repositories/conversationRepository.js";
import { ConversationService } from "./conversation/services/conversationService.js";
import { AssistantExecutionRecordRepository } from "./repositories/assistantExecutionRecordRepository.js";
import { OperationalAssistantRuntime } from "./assistant/services/operationalAssistantRuntime.js";
import { InMemoryConversationTurnLock, OperationalConversationTurnService } from "./assistant/services/operationalConversationTurnService.js";
import { WebChatConnectionRepository } from "./repositories/webChatConnectionRepository.js";
import { WebChatConnectionService } from "./webChat/services/webChatConnectionService.js";
import { createGetWebChatConnectionController, createListWebChatConnectionsController, createUpdateWebChatConnectionController, createWebChatConnectionController } from "./controllers/webChatConnectionController.js";
import { WebChatSessionRepository } from "./repositories/webChatSessionRepository.js";
import { PublicWebChatSessionService } from "./webChat/services/publicWebChatSessionService.js";
import { PublicWebChatConversationService } from "./webChat/services/publicWebChatConversationService.js";
import { createPublicWebChatRouter } from "./routes/publicWebChat.js";
import { WhatsAppWebhookService } from "./whatsapp/services/WhatsAppWebhookService.js";
import { createWhatsAppWebhookControllers } from "./controllers/WhatsAppWebhookController.js";
import { createWhatsAppWebhookRouter } from "./routes/whatsAppWebhook.js";
import { WhatsAppConversationRepository } from "./repositories/whatsappConversationRepository.js";
import { ChannelProviderEventRepository } from "./repositories/channelProviderEventRepository.js";
import { ProviderMessageRecordRepository } from "./repositories/providerMessageRecordRepository.js";
import { OutboundDeliveryRepository } from "./repositories/outboundDeliveryRepository.js";
import { WhatsAppCloudApiProvider } from "./whatsapp/providers/WhatsAppCloudApiProvider.js";
import { AesGcmWhatsAppCredentialCipher } from "./whatsapp/infrastructure/aesGcmWhatsAppCredentialCipher.js";
import { WhatsAppCredentialResolver } from "./whatsapp/services/WhatsAppCredentialResolver.js";
import { WhatsAppConnectionRepository } from "./repositories/whatsappConnectionRepository.js";
import { WhatsAppConnectionService } from "./whatsapp/services/WhatsAppConnectionService.js";
import { WhatsAppOutboundDeliveryService } from "./whatsapp/services/WhatsAppOutboundDeliveryService.js";
import { WhatsAppDeliveryStatusService } from "./whatsapp/services/WhatsAppDeliveryStatusService.js";
import { MetaDeliveryStatusMapper } from "./whatsapp/services/MetaDeliveryStatusMapper.js";
import { DeliveryLifecyclePolicy } from "./transport/domain/providerDelivery.js";
import { OperatorConversationMessagingService } from "./conversation/services/operatorConversationMessagingService.js";
import { createOperatorConversationMessageController } from "./controllers/operatorConversationMessagingController.js";
import { configureProductionAssistantReadinessControllers, configureProductionCompanyCoreControllers, configureProductionConversationMessageController, configureProductionConversationReadControllers, configureProductionConversationControlControllers, configureProductionDefaultAssistantControllers } from "./routes/authorizedCompanies.js";
import { createGetConversationController, createListConversationController } from "./controllers/conversationReadController.js";
import { ConversationControlService } from "./conversation/services/conversationControlService.js";
import { createConversationControlController } from "./controllers/conversationControlController.js";
import { createActivateWhatsAppConnectionController, createConfigureWhatsAppCredentialsController, createDeactivateWhatsAppConnectionController, createGetWhatsAppConnectionController, createGetWhatsAppConnectionStatusController, createListWhatsAppConnectionsController, createUpdateWhatsAppConnectionController, createValidateWhatsAppConnectionController, createWhatsAppConnectionController } from "./controllers/WhatsAppConnectionController.js";
import { CompanyDomainRepository } from "./repositories/companyDomainRepository.js";
import { CompanyApplicationService } from "./company/application/companyApplicationService.js";
import { createCompanyCoreControllers } from "./controllers/companyCoreController.js";
import { AssistantReadinessAssessmentRepository } from "./repositories/assistantReadinessAssessmentRepository.js";
import { AssistantReadinessService } from "./assistant/services/assistantReadinessService.js";
import { DefaultAssistantRepository } from "./repositories/defaultAssistantRepository.js";
import { DefaultAssistantService } from "./assistant/services/defaultAssistantService.js";
import { createGetDefaultAssistantController, createPutDefaultAssistantController } from "./controllers/defaultAssistantController.js";
import { createGetAssistantReadinessController, createRefreshAssistantReadinessController } from "./controllers/assistantReadinessController.js";
import { PlatformAdministratorRepository } from "./repositories/platformAdministratorRepository.js";
import { PlatformAdministrationRepository } from "./repositories/platformAdministrationRepository.js";
import { PlatformAuthorizationService } from "./platformAdmin/services/platformAuthorizationService.js";
import { PlatformAdministrationService } from "./platformAdmin/services/platformAdministrationService.js";
import { createPlatformAdminControllers } from "./controllers/platformAdminController.js";
import { createPlatformAdminRouter } from "./routes/platformAdmin.js";
import { configureProductionCommercialControls } from "./routes/authorizedCompanies.js";
import { CommercialControlsRepository } from "./repositories/commercialControlsRepository.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workspaceContext = createWorkspaceContext(workspaceRepository.resolveDefault());
const agent = new AtlasAgent(geminiProvider);
const chatService = new ChatService(companyRepository, knowledgeRepository, agent);
const companyService = new CompanyService(companyRepository);
configureProductionCompanyCoreControllers(createCompanyCoreControllers(new CompanyApplicationService(new CompanyDomainRepository(database))));
const knowledgeService = new KnowledgeService(knowledgeRepository);
const scrapeService = new ScrapeService(firecrawlProvider);
const identityTransaction = new SqliteIdentityTransaction(database);
const randomProvider = new SecureRandomProvider();
const verificationHashProvider = new Sha256VerificationHashProvider();
const identityClock = new SystemClock();
const production=process.env.NODE_ENV==="production";
if (production && (process.env.ATLAS_BOOTSTRAP_SECRET?.length ?? 0) < 32) throw new Error("Production requires ATLAS_BOOTSTRAP_SECRET with at least 32 characters.");
if (production && (!(process.env.WHATSAPP_APP_SECRET?.trim()) || !(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim()))) throw new Error("Production requires WhatsApp webhook credentials.");
const deliveryMode = emailDeliveryMode(process.env.EMAIL_PROVIDER ?? process.env.ATLAS_VERIFICATION_DELIVERY, production);
const providerDelivery = deliveryMode === "smtp"
  ? new SmtpEmailDelivery(smtpConfiguration())
  : deliveryMode === "resend"
    ? new ResendEmailDelivery(resendConfiguration())
    : deliveryMode === "google_apps_script"
      ? new GoogleAppsScriptEmailDelivery(googleAppsScriptConfiguration())
      : null;
const verificationDelivery = deliveryMode === "development"
  ? new DevelopmentVerificationDelivery(process.env.NODE_ENV ?? "development", (message) => console.info(message))
  : providerDelivery ?? new UnavailableVerificationDelivery();
const verificationOrigin = process.env.ATLAS_VERIFICATION_ORIGIN ?? "http://localhost:3000";
const verificationLifetimeMilliseconds = 24 * 60 * 60 * 1000;
const verificationCooldownMilliseconds = 60 * 1000;
const passwordProvider = new ScryptPasswordProvider();
const registrationService = new RegistrationService(identityTransaction, randomProvider, verificationHashProvider,
  identityClock, verificationDelivery, verificationOrigin, verificationLifetimeMilliseconds, passwordProvider);
const resendVerificationService = new ResendEmailVerificationService(identityTransaction, randomProvider,
  verificationHashProvider, identityClock, verificationDelivery, verificationOrigin,
  verificationLifetimeMilliseconds, verificationCooldownMilliseconds);
const verifyEmailService = new VerifyEmailService(identityTransaction, verificationHashProvider, identityClock);
const authenticationTransaction = new SqliteAuthenticationTransaction(database);
const platformAdministrators = new PlatformAdministratorRepository(database);
const platformAuthorizationService = new PlatformAuthorizationService(platformAdministrators);
const authenticationService=new AuthenticationService(authenticationTransaction,randomProvider,new Sha256CredentialEnrollmentHashProvider(),passwordProvider,new Sha256SessionIdentifierProvider(),identityClock,verificationDelivery,verificationOrigin,process.env.NODE_ENV==="production",platformAdministrators);
const passwordResetControllers = createPasswordResetControllers(new PasswordResetService(authenticationTransaction, randomProvider, verificationHashProvider, passwordProvider, identityClock, verificationDelivery, verificationOrigin));
const requestOriginPolicy=new ExactRequestOriginPolicy(production?[verificationOrigin]:[verificationOrigin,"http://localhost:5173"],production);
const authenticationControllers=createAuthenticationControllers(authenticationService,requestOriginPolicy);
const invitationDelivery=deliveryMode==="development"?new DevelopmentInvitationDelivery(process.env.NODE_ENV??"development",message=>console.info(message)):providerDelivery??new UnavailableInvitationDelivery();
const workspaceAdministrationService=new WorkspaceAdministrationService(new SqliteWorkspaceAdministrationTransaction(database),new SecureInvitationProofProvider(),identityClock,invitationDelivery,verificationOrigin);
configureProductionCommercialControls(new CommercialControlsRepository(database));
const platformBootstrapService = new PlatformBootstrapService(new SqlitePlatformBootstrapTransaction(database), randomProvider,
  new ScryptPasswordProvider(), new Sha256SessionIdentifierProvider(), identityClock, process.env.ATLAS_BOOTSTRAP_SECRET ?? "");
const platformBootstrapControllers = createPlatformBootstrapControllers(platformBootstrapService, authenticationService);
export const authorizationService=new AuthorizationService(new MembershipRepository(database),workspaceRepository);
export const authenticatedWorkspaceResolver=new WorkspaceResolver(workspaceRepository);
const assistantProfileService=new AssistantProfileService(new AssistantProfileRepository(database),identityClock);
const webChatConnectionService = new WebChatConnectionService(companyRepository, new AssistantProfileRepository(database), new WebChatConnectionRepository(database), identityClock);
const whatsAppConnections = new WhatsAppConnectionRepository(database);
const whatsAppCredentialCipher = new AesGcmWhatsAppCredentialCipher(whatsAppPlatformEncryptionKey(process.env.WHATSAPP_PLATFORM_ENCRYPTION_KEY));
const whatsAppCredentialResolver = new WhatsAppCredentialResolver(whatsAppConnections, whatsAppCredentialCipher, process.env.WHATSAPP_ACCESS_TOKEN ?? "");
const defaultAssistantService = new DefaultAssistantService(new AssistantProfileRepository(database), new DefaultAssistantRepository(database), identityClock);
configureProductionDefaultAssistantControllers({get:(context)=>createGetDefaultAssistantController(defaultAssistantService,context),put:(context,actor)=>createPutDefaultAssistantController(defaultAssistantService,context,actor.userId)});
const assistantReadinessService = new AssistantReadinessService(companyRepository, new CompanyKnowledgeRepository(database), new AssistantProfileRepository(database), whatsAppConnections, new AssistantReadinessAssessmentRepository(database), defaultAssistantService, identityClock);
configureProductionAssistantReadinessControllers({ get: (context) => createGetAssistantReadinessController(assistantReadinessService, context), refresh: (context) => createRefreshAssistantReadinessController(assistantReadinessService, context) });
const whatsAppConnectionService = new WhatsAppConnectionService(companyRepository, new AssistantProfileRepository(database), whatsAppConnections, identityClock, { credentials: whatsAppConnections, states: whatsAppConnections, cipher: whatsAppCredentialCipher, resolver: whatsAppCredentialResolver, validator: new WhatsAppCloudApiProvider("", process.env.WHATSAPP_GRAPH_API_VERSION ?? "v26.0"), knowledge: new CompanyKnowledgeRepository(database) }, assistantReadinessService);
export const conversationService = new ConversationService(new ConversationRepository(database), identityClock);
const publicWebChatSessionService = new PublicWebChatSessionService(webChatConnectionService, conversationService, new WebChatSessionRepository(database), identityClock);
export const operationalConversationTurnService = new OperationalConversationTurnService(companyRepository, new CompanyKnowledgeRepository(database), new AssistantProfileRepository(database), conversationService, new OperationalAssistantRuntime(agent, new AssistantExecutionRecordRepository(database), identityClock), new InMemoryConversationTurnLock(), "gemini", 20);
const publicWebChatConversationService = new PublicWebChatConversationService(publicWebChatSessionService, operationalConversationTurnService, conversationService);
const companyKnowledgeService=new FrozenKnowledgeService(companyRepository,new CompanyKnowledgeRepository(database),new SecurePublicUrlProvider(),new WorkerPdfTextExtractor(),new ManualTextKnowledgeFactExtractor(new GeminiKnowledgeFactExtractor(geminiProvider)),identityClock);
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
  ...passwordResetControllers,
  ...authenticationControllers,
});
export const publicWebChatRouter = createPublicWebChatRouter(publicWebChatSessionService, publicWebChatConversationService, production);
export const whatsAppOutboundDeliveryService = new WhatsAppOutboundDeliveryService(new ConversationRepository(database), whatsAppConnections, new ProviderMessageRecordRepository(database), new OutboundDeliveryRepository(database), whatsAppCredentialResolver, (accessToken) => new WhatsAppCloudApiProvider(accessToken, process.env.WHATSAPP_GRAPH_API_VERSION ?? "v26.0"), identityClock, whatsAppConnectionService, new WhatsAppConversationRepository(database));
const whatsAppDeliveryStatusService = new WhatsAppDeliveryStatusService(new ProviderMessageRecordRepository(database), new OutboundDeliveryRepository(database), new MetaDeliveryStatusMapper(), new DeliveryLifecyclePolicy(), identityClock, whatsAppConnectionService);
const operatorConversationMessagingService = new OperatorConversationMessagingService(conversationService, new ConversationRepository(database), new ConversationRepository(database), new WhatsAppConversationRepository(database), whatsAppOutboundDeliveryService, identityClock);
configureProductionConversationMessageController((context, actor) => createOperatorConversationMessageController(operatorConversationMessagingService, context, actor));
configureProductionConversationReadControllers({ list: (context) => createListConversationController(conversationService, context), get: (context) => createGetConversationController(conversationService, context) });
const conversationControlService = new ConversationControlService(conversationService, new ConversationRepository(database), identityClock);
configureProductionConversationControlControllers({ takeover: (context, actor) => createConversationControlController(conversationControlService, context, actor, "takeover"), release: (context, actor) => createConversationControlController(conversationControlService, context, actor, "release"), resolve: (context, actor) => createConversationControlController(conversationControlService, context, actor, "resolve") });
export const whatsAppWebhookService = new WhatsAppWebhookService({ appSecret: process.env.WHATSAPP_APP_SECRET ?? "", verifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "" }, whatsAppConnectionService, new WhatsAppConversationRepository(database), new ChannelProviderEventRepository(database), conversationService, operationalConversationTurnService, identityClock, new ProviderMessageRecordRepository(database), new OutboundDeliveryRepository(database), undefined, whatsAppCredentialResolver, (accessToken) => new WhatsAppCloudApiProvider(accessToken, process.env.WHATSAPP_GRAPH_API_VERSION ?? "v26.0"), new ConversationRepository(database), whatsAppOutboundDeliveryService, whatsAppDeliveryStatusService);
const whatsAppWebhookRouter = createWhatsAppWebhookRouter(createWhatsAppWebhookControllers(whatsAppWebhookService));
export const workspacesRouter=createWorkspacesRouter(createWorkspaceAdministrationControllers(workspaceAdministrationService,authenticationService,requestOriginPolicy));
export const platformAdminRouter=createPlatformAdminRouter(authenticationService,platformAuthorizationService,createPlatformAdminControllers(new PlatformAdministrationService(new PlatformAdministrationRepository(database),new CommercialControlsRepository(database))),requestOriginPolicy);
function createProductionAuthorizedCompaniesRouter(execution: AssistantExecutionPort) {
  const runtime = new OperationalAssistantRuntime(execution, new AssistantExecutionRecordRepository(database), identityClock);
  const preview = new AssistantPreviewService(companyRepository, knowledgeRepository, new AssistantProfileRepository(database), runtime, "gemini");
  const operational = new OperationalAssistantExecutionService(companyRepository, knowledgeRepository, new AssistantProfileRepository(database), runtime, new InMemoryOperationalExecutionBudget(), "gemini");
  return createAuthorizedCompaniesRouter({authentication:authenticationService,users:new UserRepository(database),authorization:authorizationService,resolver:authenticatedWorkspaceResolver,controllers:{list:context=>createListCompaniesController(companyService,context),create:context=>createCompanyController(companyService,context),get:context=>createGetCompanyController(companyService,context),update:context=>createUpdateCompanyController(companyService,context),delete:context=>createDeleteCompanyController(companyService,context),onboard:(context,actor)=>createOnboardingController(onboardingService,context,actor)},assistantControllers:{list:context=>createListAssistantProfilesController(assistantProfileService,context),create:context=>createAssistantProfileController(assistantProfileService,context),get:context=>createGetAssistantProfileController(assistantProfileService,context),update:context=>createUpdateAssistantProfileController(assistantProfileService,context),transition:context=>createTransitionAssistantProfileController(assistantProfileService,context),preview:context=>createAssistantPreviewController(preview,context),execution:context=>createOperationalAssistantExecutionController(operational,context)},webChatConnectionControllers:{list:context=>createListWebChatConnectionsController(webChatConnectionService,context),create:context=>createWebChatConnectionController(webChatConnectionService,context),get:context=>createGetWebChatConnectionController(webChatConnectionService,context),update:context=>createUpdateWebChatConnectionController(webChatConnectionService,context)},whatsAppConnectionControllers:{list:context=>createListWhatsAppConnectionsController(whatsAppConnectionService,context),create:context=>createWhatsAppConnectionController(whatsAppConnectionService,context),get:context=>createGetWhatsAppConnectionController(whatsAppConnectionService,context),update:context=>createUpdateWhatsAppConnectionController(whatsAppConnectionService,context),status:context=>createGetWhatsAppConnectionStatusController(whatsAppConnectionService,context),configureCredentials:context=>createConfigureWhatsAppCredentialsController(whatsAppConnectionService,context),validate:context=>createValidateWhatsAppConnectionController(whatsAppConnectionService,context),activate:context=>createActivateWhatsAppConnectionController(whatsAppConnectionService,context),deactivate:context=>createDeactivateWhatsAppConnectionController(whatsAppConnectionService,context)},knowledgeControllers:companyKnowledgeControllers});
}

function whatsAppPlatformEncryptionKey(value: string | undefined): Uint8Array {
  const normalized = value?.trim() ?? "";
  if (!normalized) { if (production) throw new Error("Production requires WHATSAPP_PLATFORM_ENCRYPTION_KEY."); return Buffer.alloc(32); }
  const key = /^[0-9a-f]{64}$/i.test(normalized) ? Buffer.from(normalized, "hex") : Buffer.from(normalized, "base64url");
  if (key.byteLength !== 32) throw new Error("WHATSAPP_PLATFORM_ENCRYPTION_KEY must encode exactly 32 bytes.");
  return key;
}

export const authorizedCompaniesRouter = createProductionAuthorizedCompaniesRouter(agent);

export function createProductionAppRouters(execution: AssistantExecutionPort = agent): AppRouters {
  return { authorizedCompaniesRouter: createProductionAuthorizedCompaniesRouter(execution), chatRouter, companiesRouter, identityRouter, knowledgeRouter, publicWebChatRouter, scrapeRouter, whatsAppWebhookRouter, workspacesRouter, platformAdminRouter };
}
