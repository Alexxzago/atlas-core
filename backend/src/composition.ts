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
import { database, runtimeProductionConfiguration } from "./config/database.js";
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
import { GeminiConversationIntelligenceDerivation, GeminiKnowledgeFactExtractor, geminiProvider } from "./providers/gemini.js";
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
import type { WorkspaceContext } from "./types/workspaceContext.js";
import { WhatsAppVoiceRepository } from "./repositories/whatsappVoiceRepository.js";
import { createGetVoicePolicyController, createPutVoicePolicyController } from "./controllers/voicePolicyController.js";
import { VoicePolicyService } from "./whatsapp/services/voicePolicyService.js";
import { includeVoiceSemanticHistory, resolveVoiceSemanticMessage } from "./whatsapp/services/voiceSemanticContentResolver.js";
import { VoiceDeferredSemanticRecoveryService } from "./whatsapp/services/voiceDeferredSemanticRecoveryService.js";
import { ProactiveActionRepository } from "./repositories/proactiveActionRepository.js";
import { ProactiveDueWorkerService } from "./proactive/services/proactiveDueWorkerService.js";
import { ProactiveRuntimeService } from "./proactive/services/proactiveRuntimeService.js";
import { ProactiveSemanticRecoveryService } from "./proactive/services/proactiveSemanticRecoveryService.js";
import { ProactiveActionOperatorService } from "./proactive/services/proactiveActionOperatorService.js";
import { createProactiveActionControllers } from "./controllers/proactiveActionController.js";
import {createWorkspaceAdministrationControllers}from"./controllers/workspaceAdministrationController.js";
import{createWorkspacesRouter}from"./routes/workspaces.js";
import{SqliteWorkspaceAdministrationTransaction}from"./repositories/workspaceAdministrationTransaction.js";
import{MembershipRepository}from"./repositories/workspaceAdministrationRepository.js";
import{DevelopmentInvitationDelivery,SecureInvitationProofProvider,UnavailableInvitationDelivery}from"./workspace/infrastructure/invitationProviders.js";
import{WorkspaceAdministrationService}from"./workspace/services/workspaceAdministrationService.js";
import{AuthorizationService}from"./workspace/services/authorizationService.js";
import{WorkspaceResolver}from"./workspace/services/workspaceResolver.js";
import{configureProductionCompanyOperationalStatusService,configureProductionProactiveActionControllers,configureProductionVoicePolicyControllers,createAuthorizedCompaniesRouter}from"./routes/authorizedCompanies.js";
import{UserRepository}from"./repositories/userRepository.js";
import{AssistantProfileRepository}from"./repositories/assistantProfileRepository.js";
import{AssistantProfileService}from"./assistant/services/assistantProfileService.js";
import{createAssistantProfileController,createGetAssistantProfileController,createListAssistantProfilesController,createTransitionAssistantProfileController,createUpdateAssistantProfileController}from"./controllers/assistantProfileController.js";
import { AssistantPreviewService } from "./assistant/services/assistantPreviewService.js";
import { createAssistantPreviewController } from "./controllers/assistantPreviewController.js";
import { ExactRequestOriginPolicy } from "./identity/infrastructure/requestOriginPolicy.js";
import { CompanyKnowledgeRepository } from "./repositories/companyKnowledgeRepository.js";
import { KnowledgeRetrievalRepository } from "./repositories/knowledgeRetrievalRepository.js";
import { KnowledgeService as FrozenKnowledgeService } from "./knowledge/services/knowledgeServices.js";
import { KnowledgeIndexingService, LexicalKnowledgeRetrievalService } from "./knowledgeV2/services/knowledgeRetrievalService.js";
import { SecurePublicUrlProvider } from "./knowledge/infrastructure/publicUrlProvider.js";
import { WorkerPdfTextExtractor } from "./knowledge/infrastructure/pdfTextExtractor.js";
import { createCompanyKnowledgeControllers } from "./controllers/companyKnowledgeController.js";
import { createOperationalAssistantExecutionController } from "./controllers/operationalAssistantExecutionController.js";
import { SharedOperationalExecutionBudget } from "./assistant/application/operationalExecutionBudget.js";
import { RateLimitService } from "./abuse/rateLimitService.js";
import { SharedRateLimitRepository } from "./abuse/sharedRateLimitRepository.js";
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
import { MetaInboundMediaProvider } from "./whatsapp/providers/MetaInboundMediaProvider.js";
import { whatsAppCredentialCipherFromEnvironment } from "./whatsapp/infrastructure/aesGcmWhatsAppCredentialCipher.js";
import { WhatsAppCredentialResolver } from "./whatsapp/services/WhatsAppCredentialResolver.js";
import { WhatsAppConnectionRepository } from "./repositories/whatsappConnectionRepository.js";
import { WhatsAppInboundMediaRepository } from "./repositories/whatsappInboundMediaRepository.js";
import { WhatsAppConnectionService } from "./whatsapp/services/WhatsAppConnectionService.js";
import { WhatsAppOutboundDeliveryService } from "./whatsapp/services/WhatsAppOutboundDeliveryService.js";
import { WhatsAppDeliveryStatusService } from "./whatsapp/services/WhatsAppDeliveryStatusService.js";
import { MetaDeliveryStatusMapper } from "./whatsapp/services/MetaDeliveryStatusMapper.js";
import { DeliveryLifecyclePolicy } from "./transport/domain/providerDelivery.js";
import { OperatorConversationMessagingService } from "./conversation/services/operatorConversationMessagingService.js";
import { createOperatorConversationMessageController } from "./controllers/operatorConversationMessagingController.js";
import { configureProductionAssistantReadinessControllers, configureProductionCompanyCoreControllers, configureProductionConversationMessageController, configureProductionConversationReadControllers, configureProductionConversationControlControllers, configureProductionDefaultAssistantControllers } from "./routes/authorizedCompanies.js";
import { createGetConversationController, createListConversationController } from "./controllers/conversationReadController.js";
import { createVoicePlaybackController, createVoiceReadController } from "./controllers/voiceReadController.js";
import { VoiceReadService } from "./whatsapp/services/voiceReadService.js";
import { ConversationControlService } from "./conversation/services/conversationControlService.js";
import { createConversationControlController } from "./controllers/conversationControlController.js";
import { createConversationEventFeedController } from "./controllers/conversationEventFeedController.js";
import { ConversationEventFeedService } from "./conversation/services/conversationEventFeedService.js";
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
import { configureProductionAssistantCapabilityControllers, configureProductionCommercialControls } from "./routes/authorizedCompanies.js";
import { CommercialControlsRepository } from "./repositories/commercialControlsRepository.js";
import { BillingEntitlementService } from "./billing/services/billingEntitlementService.js";
import { SynchronousSqlDatabaseAdapter } from "./config/sqlDatabase.js";
import { AssistantCapabilityRepository } from "./repositories/assistantCapabilityRepository.js";
import { productionAssistantCapabilityCatalog } from "./assistant/domain/assistantCapability.js";
import { AssistantCapabilityService } from "./assistant/services/assistantCapabilityService.js";
import { AssistantCapabilityCatalogService } from "./assistant/services/assistantCapabilityCatalogService.js";
import { createListAssistantCapabilitiesController, createListAssistantCapabilityCatalogController, createReplaceAssistantCapabilitiesController } from "./controllers/assistantCapabilityController.js";
import { ToolRegistry } from "./assistant/application/toolRegistry.js";
import { NoIntegrationToolAvailabilityPolicy } from "./assistant/application/toolContracts.js";
import { IntegrationToolAvailabilityPolicy } from "./integrations/services/integrationToolAvailabilityPolicy.js";
import { IntegrationConnectionRepository } from "./repositories/integrationConnectionRepository.js";
import { integrationSecretCipherRingFromEnvironment } from "./integrations/infrastructure/aesGcmIntegrationSecretCipher.js";
import { googleCalendarAccessTokenProviderFromEnvironment } from "./integrations/providers/googleCalendarAccessTokenProvider.js";
import { AssistantToolOrchestrator } from "./assistant/services/assistantToolOrchestrator.js";
import { ToolExecutionService } from "./assistant/services/toolExecutionService.js";
import { AssistantToolExecutionTraceRepository } from "./repositories/assistantToolExecutionTraceRepository.js";
import { ConversationIntelligenceRepository } from "./repositories/conversationIntelligenceRepository.js";
import { ConversationIntelligenceService } from "./conversationIntelligence/services/conversationIntelligenceService.js";
import { ConversationToolMemoryRepository } from "./repositories/conversationToolMemoryRepository.js";
import { ConversationToolMemoryCoordinator } from "./conversationIntelligence/services/conversationToolMemoryCoordinator.js";
import { FakeLiveDataProvider } from "./liveData/infrastructure/fakeLiveDataProvider.js";
import { LiveDataService } from "./liveData/services/liveDataService.js";
import { LiveDataToolAvailabilityPolicy } from "./liveData/services/liveDataToolAvailabilityPolicy.js";
import { LiveDataObservationRepository } from "./repositories/liveDataObservationRepository.js";
import { liveDataReadToolDefinition } from "./liveData/application/liveDataReadToolDefinition.js";
import { BookingRepository } from "./repositories/bookingRepository.js";
import { BookingCommandService } from "./scheduling/services/bookingCommandService.js";
import { BookingQueryService } from "./scheduling/services/bookingQueryService.js";
import { schedulingBookingToolDefinitions } from "./scheduling/application/bookingToolDefinitions.js";
import { createLocalMediaCore, createMediaCore } from "./media/composition.js";
import { S3MediaStorage } from "./media/infrastructure/s3MediaStorage.js";
import { UnavailableMediaStorage } from "./media/infrastructure/unavailableMediaStorage.js";
import { SafeConversationAttachmentService } from "./media/services/safeConversationAttachmentService.js";
import { SafeConversationAttachmentRepository } from "./repositories/safeConversationAttachmentRepository.js";
import { WhatsAppInboundMediaRecoveryService } from "./whatsapp/services/WhatsAppInboundMediaRecoveryService.js";
import { ProviderAdapterRegistry, RegistryIntegrationProviderValidator } from "./integrations/application/providerAdapterRegistry.js";
import { ScopedExternalProviderCredentialResolver } from "./integrations/services/scopedExternalProviderCredentialResolver.js";
import { IntegrationConnectionService } from "./integrations/services/integrationConnectionService.js";
import { GoogleCalendarValidationHttpTransport, GoogleCalendarValidationProvider } from "./integrations/providers/googleCalendarValidationProvider.js";
import { GoogleCalendarFreeBusyProvider } from "./integrations/providers/googleCalendarFreeBusyProvider.js";
import { GoogleCalendarEventsProvider } from "./integrations/providers/googleCalendarEventsProvider.js";
import { GoogleCalendarHttpTransport } from "./integrations/providers/googleCalendarTransport.js";
import { metaEmbeddedSignupProviderFromEnvironment } from "./whatsapp/providers/MetaEmbeddedSignupProvider.js";
import { MetaWhatsAppIntegrationValidationProvider } from "./whatsapp/application/metaEmbeddedSignupIntegration.js";
import { ExternalCalendarRepository } from "./repositories/externalCalendarRepository.js";
import { ExternalCalendarBindingService } from "./scheduling/services/externalCalendarBindingService.js";
import { ExternalBusyRefreshService } from "./scheduling/services/externalBusyRefreshService.js";
import { ExternalBookingCreateService } from "./scheduling/services/externalBookingCreateService.js";
import { ExternalBookingCancelService, ExternalBookingRescheduleService } from "./scheduling/services/externalBookingMutationServices.js";
import { SchedulingBookingRouter } from "./scheduling/services/schedulingBookingRouter.js";
import { SchedulingService } from "./scheduling/services/schedulingService.js";
import { SchedulingRepository } from "./repositories/schedulingRepository.js";
import { billingProviderRegistryFromEnvironment } from "./billing/application/billingProviderConfiguration.js";
import { BillingOperationService } from "./billing/application/billingOperationService.js";
import { BillingPayerIdentityResolver } from "./billing/application/billingPayerIdentityResolver.js";
import { BillingAccountRepository, BillingCatalogRepository, BillingSubscriptionRepository } from "./repositories/billingRepository.js";
import { BillingOperationRepository } from "./repositories/billingOperationRepository.js";
import { BillingWebhookRepository } from "./repositories/billingWebhookRepository.js";
import { BillingWebhookService } from "./billing/application/billingWebhookService.js";
import { BillingReconciliationRepository } from "./repositories/billingReconciliationRepository.js";
import { BillingReconciliationWorker } from "./billing/services/billingReconciliationWorker.js";
import { BillingOperationRecoveryWorker } from "./billing/services/billingOperationRecoveryWorker.js";
import { BillingReconciliationRuntime, billingReconciliationRuntimeConfiguration } from "./billing/services/billingReconciliationRuntime.js";
import { createBillingWebhookController } from "./controllers/billingWebhookController.js";
import { createBillingWebhookRouter } from "./routes/billingWebhook.js";
import { BillingApplicationService } from "./billing/application/billingApplicationService.js";
import { createBillingControllers } from "./controllers/billingController.js";
import { createBillingRouter } from "./routes/billing.js";

import { MetaEmbeddedSignupAttemptRepository } from "./repositories/metaEmbeddedSignupAttemptRepository.js";
import { HmacMetaEmbeddedSignupDigestProvider, MetaEmbeddedSignupAttemptService, metaEmbeddedSignupStateHmacKeyFromEnvironment } from "./whatsapp/application/metaEmbeddedSignupAttemptService.js";
import { StructuredMetaEmbeddedSignupAudit } from "./whatsapp/application/metaEmbeddedSignupAudit.js";
import { MetaEmbeddedSignupCompletionService } from "./whatsapp/application/metaEmbeddedSignupCompletionService.js";
import { SqlMetaEmbeddedSignupCompletionFinalizer } from "./whatsapp/application/metaEmbeddedSignupCompletionFinalizer.js";
import { MetaWhatsAppReadinessService } from "./whatsapp/application/metaWhatsAppReadinessService.js";
import { MetaEmbeddedSignupHttpService, embeddedSignupPublicConfig } from "./whatsapp/application/metaEmbeddedSignupHttpService.js";
import { createMetaEmbeddedSignupControllers } from "./controllers/metaEmbeddedSignupController.js";
import { CompanyOperationalStatusService } from "./company/services/companyOperationalStatusService.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runtimeConfiguration = runtimeProductionConfiguration;
const workspaceContext = createWorkspaceContext(workspaceRepository.resolveDefault());
const agent = new AtlasAgent(geminiProvider);
const chatService = new ChatService(companyRepository, knowledgeRepository, agent);
const billingEntitlements = new BillingEntitlementService(database);
const companyService = new CompanyService(companyRepository, billingEntitlements);
configureProductionCompanyCoreControllers(createCompanyCoreControllers(new CompanyApplicationService(new CompanyDomainRepository(database), { entitlements: billingEntitlements })));
const knowledgeService = new KnowledgeService(knowledgeRepository);
const scrapeService = new ScrapeService(firecrawlProvider);
const identityTransaction = new SqliteIdentityTransaction(database);
const randomProvider = new SecureRandomProvider();
const verificationHashProvider = new Sha256VerificationHashProvider();
const identityClock = new SystemClock();
const rateLimits = new RateLimitService(new SharedRateLimitRepository(database), () => identityClock.now());
export const billingProviderRegistry = billingProviderRegistryFromEnvironment();
export const billingOperationService = new BillingOperationService(new BillingAccountRepository(database),new BillingCatalogRepository(database),new BillingSubscriptionRepository(database),new BillingOperationRepository(database),billingProviderRegistry,()=>identityClock.now(),new BillingPayerIdentityResolver(database));
export const billingWebhookService = new BillingWebhookService({stripe:process.env.STRIPE_WEBHOOK_SIGNING_SECRET?.trim() ?? "",mercadopago:process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim() ?? ""},new BillingWebhookRepository(database),()=>identityClock.now());
export const billingReconciliationWorker = new BillingReconciliationWorker(new BillingReconciliationRepository(database),billingProviderRegistry,()=>identityClock.now());
export const billingOperationRecoveryWorker = new BillingOperationRecoveryWorker(new BillingOperationRepository(database),billingProviderRegistry,()=>identityClock.now());
export const billingReconciliationRuntime = new BillingReconciliationRuntime(billingReconciliationWorker, billingReconciliationRuntimeConfiguration(),{},billingOperationRecoveryWorker);
const production=process.env.NODE_ENV==="production";
export const mediaCore = runtimeConfiguration
  ? createMediaCore(database, runtimeConfiguration.mediaStorage ? new S3MediaStorage(runtimeConfiguration.mediaStorage) : new UnavailableMediaStorage(), identityClock)
  : createLocalMediaCore(database, resolve(repositoryRoot, "media"), identityClock);
const deliveryMode = runtimeConfiguration?.emailDeliveryMode ?? emailDeliveryMode(process.env.EMAIL_PROVIDER ?? process.env.ATLAS_VERIFICATION_DELIVERY, production);
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
const verificationOrigin = runtimeConfiguration?.verificationOrigin ?? process.env.ATLAS_VERIFICATION_ORIGIN ?? "http://localhost:3000";
const billingReturnOrigin = process.env.ATLAS_BILLING_RETURN_ORIGIN?.trim() || verificationOrigin;
const billingReturnUrl = (path:string):string => new URL(path, billingReturnOrigin).toString();
const billingApplicationService = new BillingApplicationService(database, billingOperationService, { checkoutSuccess:billingReturnUrl("/billing/checkout/success"), checkoutCancel:billingReturnUrl("/billing/checkout/cancel"), portalReturn:billingReturnUrl("/billing/portal/return") },()=>identityClock.now());
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
const passwordResetControllers = createPasswordResetControllers(new PasswordResetService(authenticationTransaction, randomProvider, verificationHashProvider, passwordProvider, identityClock, verificationDelivery, verificationOrigin), rateLimits);
const requestOriginPolicy=new ExactRequestOriginPolicy(production?[verificationOrigin]:[verificationOrigin,"http://localhost:5173"],production);
const authenticationControllers=createAuthenticationControllers(authenticationService,requestOriginPolicy,rateLimits);
const invitationDelivery=deliveryMode==="development"?new DevelopmentInvitationDelivery(process.env.NODE_ENV??"development",message=>console.info(message)):providerDelivery??new UnavailableInvitationDelivery();
const workspaceAdministrationService=new WorkspaceAdministrationService(new SqliteWorkspaceAdministrationTransaction(database),new SecureInvitationProofProvider(),identityClock,invitationDelivery,verificationOrigin,undefined,rateLimits);
configureProductionCommercialControls(new CommercialControlsRepository(database));
const platformBootstrapService = new PlatformBootstrapService(new SqlitePlatformBootstrapTransaction(database), randomProvider,
  new ScryptPasswordProvider(), new Sha256SessionIdentifierProvider(), identityClock, process.env.ATLAS_BOOTSTRAP_SECRET ?? "");
const platformBootstrapControllers = createPlatformBootstrapControllers(platformBootstrapService, authenticationService);
export const authorizationService=new AuthorizationService(new MembershipRepository(database),workspaceRepository);
export const authenticatedWorkspaceResolver=new WorkspaceResolver(workspaceRepository);
const assistantProfileService=new AssistantProfileService(new AssistantProfileRepository(database),identityClock,billingEntitlements);
const assistantCapabilityRepository=new AssistantCapabilityRepository(new SynchronousSqlDatabaseAdapter(database));
const integrationConnections = new IntegrationConnectionRepository(new SynchronousSqlDatabaseAdapter(database));
export const integrationSecretCipher = integrationSecretCipherRingFromEnvironment();
export const googleCalendarAccessTokenProvider = googleCalendarAccessTokenProviderFromEnvironment(process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID, process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET);
export const metaEmbeddedSignupProvider = metaEmbeddedSignupProviderFromEnvironment();
export const providerAdapterRegistry = new ProviderAdapterRegistry();
const externalCalendarRepository = new ExternalCalendarRepository(new SynchronousSqlDatabaseAdapter(database));
const schedulingRepository = new SchedulingRepository(new SynchronousSqlDatabaseAdapter(database));
const externalCalendarBindingService = new ExternalCalendarBindingService(externalCalendarRepository, schedulingRepository, integrationConnections, identityClock);
const externalSchedulingService = new SchedulingService(schedulingRepository, identityClock);
const scopedExternalProviderCredentials = integrationSecretCipher ? new ScopedExternalProviderCredentialResolver(integrationConnections, integrationSecretCipher) : null;
if (integrationSecretCipher && googleCalendarAccessTokenProvider && scopedExternalProviderCredentials) providerAdapterRegistry.register({ provider: "google_calendar", kind: "calendar", validation: new GoogleCalendarValidationProvider(googleCalendarAccessTokenProvider, new GoogleCalendarValidationHttpTransport(), identityClock), calendarBusy: new GoogleCalendarFreeBusyProvider(scopedExternalProviderCredentials, googleCalendarAccessTokenProvider, new GoogleCalendarHttpTransport()), calendarEvents: new GoogleCalendarEventsProvider(scopedExternalProviderCredentials, googleCalendarAccessTokenProvider, new GoogleCalendarHttpTransport()) });
if (integrationSecretCipher && metaEmbeddedSignupProvider) providerAdapterRegistry.register({ provider: "meta_whatsapp", kind: "cloud_api", validation: new MetaWhatsAppIntegrationValidationProvider(metaEmbeddedSignupProvider) });
export const integrationConnectionService = integrationSecretCipher ? new IntegrationConnectionService(integrationConnections, integrationSecretCipher, new RegistryIntegrationProviderValidator(providerAdapterRegistry), identityClock) : null;
export const externalBusyRefreshService = new ExternalBusyRefreshService(externalCalendarBindingService, providerAdapterRegistry, schedulingRepository, identityClock);
const liveDataProvider = new FakeLiveDataProvider();
const liveDataService = new LiveDataService(new LiveDataObservationRepository(new SynchronousSqlDatabaseAdapter(database)), integrationConnections, liveDataProvider, identityClock);
const bookingRepository = new BookingRepository(new SynchronousSqlDatabaseAdapter(database));
export const externalBookingCreateService = new ExternalBookingCreateService(externalSchedulingService, schedulingRepository, externalCalendarBindingService, externalCalendarRepository, bookingRepository, providerAdapterRegistry, identityClock);
export const externalBookingRescheduleService = new ExternalBookingRescheduleService(externalSchedulingService, schedulingRepository, externalCalendarBindingService, externalCalendarRepository, bookingRepository, providerAdapterRegistry, identityClock);
export const externalBookingCancelService = new ExternalBookingCancelService(schedulingRepository, externalCalendarBindingService, externalCalendarRepository, bookingRepository, providerAdapterRegistry, identityClock);
const bookingCommands = new BookingCommandService(bookingRepository, identityClock);
const bookingQueries = new BookingQueryService(bookingRepository);
export const schedulingBookingRouter = new SchedulingBookingRouter(bookingCommands, externalCalendarBindingService, externalBookingCreateService, externalBookingRescheduleService, externalBookingCancelService, bookingRepository, externalCalendarRepository, schedulingRepository);
const productionToolRegistry=new ToolRegistry(productionAssistantCapabilityCatalog,[liveDataReadToolDefinition(liveDataService),...schedulingBookingToolDefinitions(bookingCommands,bookingQueries)]);
const productionToolAvailability=new LiveDataToolAvailabilityPolicy(new IntegrationToolAvailabilityPolicy(new NoIntegrationToolAvailabilityPolicy(),integrationConnections),integrationConnections);
const assistantCapabilityService=new AssistantCapabilityService(productionAssistantCapabilityCatalog,assistantCapabilityRepository,identityClock);
const assistantCapabilityCatalogService=new AssistantCapabilityCatalogService(productionAssistantCapabilityCatalog,assistantCapabilityRepository,productionToolRegistry,productionToolAvailability);
configureProductionAssistantCapabilityControllers({list:context=>createListAssistantCapabilitiesController(assistantCapabilityService,context),catalog:context=>createListAssistantCapabilityCatalogController(assistantCapabilityCatalogService,context),replace:(context,actor)=>createReplaceAssistantCapabilitiesController(assistantCapabilityService,context,actor)});
const productionAssistantTools=new AssistantToolOrchestrator(geminiProvider.toolModel(),productionToolRegistry,assistantCapabilityRepository,productionToolAvailability,new ToolExecutionService(new AssistantToolExecutionTraceRepository(new SynchronousSqlDatabaseAdapter(database)),identityClock),identityClock);
const webChatConnectionService = new WebChatConnectionService(companyRepository, new AssistantProfileRepository(database), new WebChatConnectionRepository(database), identityClock, billingEntitlements);
const whatsAppConnections = new WhatsAppConnectionRepository(database);
export const whatsAppCredentialCipher = whatsAppCredentialCipherFromEnvironment();
const whatsAppCredentialResolver = new WhatsAppCredentialResolver(whatsAppConnections, whatsAppCredentialCipher, process.env.WHATSAPP_ACCESS_TOKEN ?? "", integrationSecretCipher ? { repository: whatsAppConnections, cipher: integrationSecretCipher } : undefined);
export const whatsAppInboundMediaProvider = new MetaInboundMediaProvider(whatsAppConnections, whatsAppCredentialResolver, { graphVersion: process.env.WHATSAPP_GRAPH_API_VERSION ?? "v26.0" });
export const whatsAppInboundMediaRecoveryService = new WhatsAppInboundMediaRecoveryService(new WhatsAppInboundMediaRepository(database), whatsAppInboundMediaProvider, mediaCore.service, new ChannelProviderEventRepository(database), identityClock);
const defaultAssistantService = new DefaultAssistantService(new AssistantProfileRepository(database), new DefaultAssistantRepository(database), identityClock);
configureProductionDefaultAssistantControllers({get:(context)=>createGetDefaultAssistantController(defaultAssistantService,context),put:(context,actor)=>createPutDefaultAssistantController(defaultAssistantService,context,actor.userId)});
const assistantReadinessService = new AssistantReadinessService(companyRepository, new CompanyKnowledgeRepository(database), new AssistantProfileRepository(database), whatsAppConnections, new AssistantReadinessAssessmentRepository(database), defaultAssistantService, identityClock);
configureProductionCompanyOperationalStatusService(new CompanyOperationalStatusService(companyRepository, new AssistantReadinessAssessmentRepository(database), whatsAppConnections));
configureProductionAssistantReadinessControllers({ get: (context) => createGetAssistantReadinessController(assistantReadinessService, context), refresh: (context) => createRefreshAssistantReadinessController(assistantReadinessService, context) });
const whatsAppConnectionService = new WhatsAppConnectionService(companyRepository, new AssistantProfileRepository(database), whatsAppConnections, identityClock, { credentials: whatsAppConnections, states: whatsAppConnections, cipher: whatsAppCredentialCipher, resolver: whatsAppCredentialResolver, validator: new WhatsAppCloudApiProvider("", process.env.WHATSAPP_GRAPH_API_VERSION ?? "v26.0"), knowledge: new CompanyKnowledgeRepository(database) }, assistantReadinessService, billingEntitlements);
whatsAppConnectionService.setRateLimiter(rateLimits);
const metaEmbeddedSignupAudit = new StructuredMetaEmbeddedSignupAudit();
const embeddedAttempts = metaEmbeddedSignupProvider && integrationConnectionService && process.env.META_EMBEDDED_SIGNUP_STATE_HMAC_KEY ? new MetaEmbeddedSignupAttemptService(new MetaEmbeddedSignupAttemptRepository(new SynchronousSqlDatabaseAdapter(database)),new HmacMetaEmbeddedSignupDigestProvider(metaEmbeddedSignupStateHmacKeyFromEnvironment()),identityClock,600_000,metaEmbeddedSignupAudit) : null;
const embeddedCompletion = embeddedAttempts && metaEmbeddedSignupProvider && integrationConnectionService ? new MetaEmbeddedSignupCompletionService(embeddedAttempts,metaEmbeddedSignupProvider,integrationConnectionService,new SqlMetaEmbeddedSignupCompletionFinalizer(new SynchronousSqlDatabaseAdapter(database)),identityClock,process.env.META_GRAPH_API_VERSION ?? "v26.0",metaEmbeddedSignupAudit) : null;
const embeddedReadiness = metaEmbeddedSignupProvider && integrationConnectionService ? new MetaWhatsAppReadinessService(whatsAppConnections,whatsAppCredentialResolver,integrationConnectionService,whatsAppConnectionService,metaEmbeddedSignupProvider,metaEmbeddedSignupAudit,identityClock): null;
const metaEmbeddedSignupControllers=createMetaEmbeddedSignupControllers(new MetaEmbeddedSignupHttpService(embeddedAttempts,embeddedCompletion,embeddedReadiness,assistantProfileService,whatsAppConnectionService,whatsAppConnections,embeddedAttempts ? embeddedSignupPublicConfig() : {available:false},rateLimits));
export const conversationService = new ConversationService(new ConversationRepository(database), identityClock);
const publicWebChatSessionService = new PublicWebChatSessionService(webChatConnectionService, conversationService, new WebChatSessionRepository(database), identityClock);
const conversationIntelligenceService = new ConversationIntelligenceService(new ConversationIntelligenceRepository(database), new GeminiConversationIntelligenceDerivation(geminiProvider), identityClock);
const conversationToolMemory = new ConversationToolMemoryCoordinator(new ConversationToolMemoryRepository(new SynchronousSqlDatabaseAdapter(database)), identityClock);
const knowledgeRetrievalService=new LexicalKnowledgeRetrievalService(new KnowledgeRetrievalRepository(database));
const voiceSemanticRepository = new WhatsAppVoiceRepository(database);
const voicePolicyService = new VoicePolicyService(voiceSemanticRepository, identityClock);
configureProductionVoicePolicyControllers({get:(context)=>createGetVoicePolicyController(voicePolicyService,context),put:(context,actor)=>createPutVoicePolicyController(voicePolicyService,context,actor)});
export const voiceDeferredSemanticRecoveryService = new VoiceDeferredSemanticRecoveryService(voiceSemanticRepository, conversationIntelligenceService);
const proactiveActions = new ProactiveActionRepository(database);
const proactiveActionOperatorService = new ProactiveActionOperatorService(proactiveActions, identityClock, rateLimits);
configureProductionProactiveActionControllers(createProactiveActionControllers(proactiveActionOperatorService));
export const proactiveSemanticRecoveryService = new ProactiveSemanticRecoveryService(proactiveActions, conversationIntelligenceService);
const productionOperationalAssistantRuntime = new OperationalAssistantRuntime(agent, new AssistantExecutionRecordRepository(database), identityClock, productionAssistantTools);
export const proactiveDueWorkerService = new ProactiveDueWorkerService(proactiveActions, identityClock, new ProactiveRuntimeService(proactiveActions, companyRepository, new CompanyKnowledgeRepository(database), new AssistantProfileRepository(database), conversationService, productionOperationalAssistantRuntime, identityClock, conversationIntelligenceService, knowledgeRetrievalService));
const voiceSemanticProjection = { resolveInbound: (context: WorkspaceContext, companyId: number, message: import("./conversation/domain/conversation.js").ConversationMessage) => resolveVoiceSemanticMessage(voiceSemanticRepository, context, companyId, message), includeHistory: (context: WorkspaceContext, companyId: number, message: import("./conversation/domain/conversation.js").ConversationMessage) => includeVoiceSemanticHistory(voiceSemanticRepository, context, companyId, message), applyAssistant: (context: WorkspaceContext, companyId: number, message: import("./conversation/domain/conversation.js").ConversationMessage) => includeVoiceSemanticHistory(voiceSemanticRepository, context, companyId, message) };
export const operationalConversationTurnService = new OperationalConversationTurnService(companyRepository, new CompanyKnowledgeRepository(database), new AssistantProfileRepository(database), conversationService, productionOperationalAssistantRuntime, new InMemoryConversationTurnLock(), "gemini", 20, conversationIntelligenceService, conversationToolMemory, knowledgeRetrievalService, new SafeConversationAttachmentService(new SafeConversationAttachmentRepository(database)), new ConversationRepository(database), voiceSemanticProjection);
const publicWebChatConversationService = new PublicWebChatConversationService(publicWebChatSessionService, operationalConversationTurnService, conversationService, rateLimits);
const knowledgeIndexingService=new KnowledgeIndexingService(new KnowledgeRetrievalRepository(database));
const companyKnowledgeService=new FrozenKnowledgeService(companyRepository,new CompanyKnowledgeRepository(database),new SecurePublicUrlProvider(),new WorkerPdfTextExtractor(),new ManualTextKnowledgeFactExtractor(new GeminiKnowledgeFactExtractor(geminiProvider)),identityClock,undefined,knowledgeIndexingService);
const companyKnowledgeControllers=createCompanyKnowledgeControllers(companyKnowledgeService,rateLimits);
const onboardingService = new OnboardingService(companyRepository,knowledgeRepository,firecrawlProvider,geminiProvider,cleanMarkdown,new FileMarkdownDebugStore(resolve(repositoryRoot,"knowledge")),companyKnowledgeService,rateLimits);

export const chatRouter = createChatRouter(createChatController(chatService, workspaceContext));
export const companiesRouter = createCompaniesRouter({
  list: createListCompaniesController(companyService, workspaceContext),
  create: createCompanyController(companyService, workspaceContext),
  get: createGetCompanyController(companyService, workspaceContext),
  update: createUpdateCompanyController(companyService, workspaceContext),
  delete: createDeleteCompanyController(companyService, workspaceContext),
  onboard: createOnboardingController(onboardingService, workspaceContext, undefined, rateLimits),
});
export const knowledgeRouter = createKnowledgeRouter(createKnowledgeController(knowledgeService, workspaceContext));
export const scrapeRouter = createScrapeRouter(createScrapeController(scrapeService));
export const identityRouter = createIdentityRouter({
  register: createRegistrationController(registrationService, rateLimits),
  resend: createResendVerificationController(resendVerificationService, rateLimits),
  verify: createVerifyEmailController(verifyEmailService),
  bootstrapStatus: platformBootstrapControllers.status,
  platformBootstrap: platformBootstrapControllers.bootstrap,
  ...passwordResetControllers,
  ...authenticationControllers,
});
export const publicWebChatRouter = createPublicWebChatRouter(publicWebChatSessionService, publicWebChatConversationService, production);
export const whatsAppOutboundDeliveryService = new WhatsAppOutboundDeliveryService(new ConversationRepository(database), whatsAppConnections, new ProviderMessageRecordRepository(database), new OutboundDeliveryRepository(database), whatsAppCredentialResolver, (accessToken) => new WhatsAppCloudApiProvider(accessToken, process.env.WHATSAPP_GRAPH_API_VERSION ?? "v26.0"), identityClock, whatsAppConnectionService, new WhatsAppConversationRepository(database), voiceSemanticRepository, voiceDeferredSemanticRecoveryService, proactiveSemanticRecoveryService);
const whatsAppDeliveryStatusService = new WhatsAppDeliveryStatusService(new ProviderMessageRecordRepository(database), new OutboundDeliveryRepository(database), new MetaDeliveryStatusMapper(), new DeliveryLifecyclePolicy(), identityClock, whatsAppConnectionService);
const operatorConversationMessagingService = new OperatorConversationMessagingService(conversationService, new ConversationRepository(database), new ConversationRepository(database), new WhatsAppConversationRepository(database), whatsAppOutboundDeliveryService, identityClock, conversationIntelligenceService, rateLimits);
configureProductionConversationMessageController((context, actor) => createOperatorConversationMessageController(operatorConversationMessagingService, context, actor));
  const conversationEventFeedService = new ConversationEventFeedService(new ConversationRepository(database));
  const voiceReadService = new VoiceReadService(voiceSemanticRepository, mediaCore.service);
  configureProductionConversationReadControllers({ list: (context, actor) => createListConversationController(conversationService, context, actor), get: (context, actor) => createGetConversationController(conversationService, context, actor), feed: (context) => createConversationEventFeedController(conversationEventFeedService, context), voice: (context) => createVoiceReadController(voiceReadService, context), playback: (context) => createVoicePlaybackController(voiceReadService, context) });
const conversationControlService = new ConversationControlService(conversationService, new ConversationRepository(database), identityClock);
configureProductionConversationControlControllers({ takeover: (context, actor) => createConversationControlController(conversationControlService, context, actor, "takeover"), release: (context, actor) => createConversationControlController(conversationControlService, context, actor, "release"), resolve: (context, actor) => createConversationControlController(conversationControlService, context, actor, "resolve") });
export const whatsAppWebhookService = new WhatsAppWebhookService({ appSecret: process.env.WHATSAPP_APP_SECRET ?? "", verifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "" }, whatsAppConnectionService, new WhatsAppConversationRepository(database), new ChannelProviderEventRepository(database), conversationService, operationalConversationTurnService, identityClock, new ProviderMessageRecordRepository(database), new OutboundDeliveryRepository(database), undefined, whatsAppCredentialResolver, (accessToken) => new WhatsAppCloudApiProvider(accessToken, process.env.WHATSAPP_GRAPH_API_VERSION ?? "v26.0"), new ConversationRepository(database), whatsAppOutboundDeliveryService, whatsAppDeliveryStatusService);
const whatsAppWebhookRouter = runtimeConfiguration && !runtimeConfiguration.whatsAppWebhookEnabled ? undefined : createWhatsAppWebhookRouter(createWhatsAppWebhookControllers(whatsAppWebhookService));
const billingWebhookRouter = createBillingWebhookRouter({stripe:createBillingWebhookController(billingWebhookService,"stripe"),mercadoPago:createBillingWebhookController(billingWebhookService,"mercadopago")});
export const workspacesRouter=createWorkspacesRouter(createWorkspaceAdministrationControllers(workspaceAdministrationService,authenticationService,requestOriginPolicy));
const billingRouter=createBillingRouter({authentication:authenticationService,users:new UserRepository(database),authorization:authorizationService,resolver:authenticatedWorkspaceResolver,originPolicy:requestOriginPolicy,controllers:createBillingControllers(billingApplicationService,rateLimits)});
export const platformAdminRouter=createPlatformAdminRouter(authenticationService,platformAuthorizationService,createPlatformAdminControllers(new PlatformAdministrationService(new PlatformAdministrationRepository(database),new CommercialControlsRepository(database))),requestOriginPolicy);
function createProductionAuthorizedCompaniesRouter(execution: AssistantExecutionPort) {
  const runtime = new OperationalAssistantRuntime(execution, new AssistantExecutionRecordRepository(database), identityClock, execution===agent?productionAssistantTools:undefined);
const preview = new AssistantPreviewService(companyRepository, knowledgeRepository, new AssistantProfileRepository(database), runtime, "gemini", knowledgeRetrievalService, rateLimits);
  const operational = new OperationalAssistantExecutionService(companyRepository, knowledgeRepository, new AssistantProfileRepository(database), runtime, new SharedOperationalExecutionBudget(new RateLimitService(new SharedRateLimitRepository(database), () => identityClock.now())), "gemini", knowledgeRetrievalService);
  return createAuthorizedCompaniesRouter({authentication:authenticationService,users:new UserRepository(database),authorization:authorizationService,resolver:authenticatedWorkspaceResolver,controllers:{list:context=>createListCompaniesController(companyService,context),create:context=>createCompanyController(companyService,context),get:context=>createGetCompanyController(companyService,context),update:context=>createUpdateCompanyController(companyService,context),delete:context=>createDeleteCompanyController(companyService,context),onboard:(context,actor)=>createOnboardingController(onboardingService,context,actor)},assistantControllers:{list:context=>createListAssistantProfilesController(assistantProfileService,context),create:context=>createAssistantProfileController(assistantProfileService,context),get:context=>createGetAssistantProfileController(assistantProfileService,context),update:context=>createUpdateAssistantProfileController(assistantProfileService,context),transition:context=>createTransitionAssistantProfileController(assistantProfileService,context),preview:context=>createAssistantPreviewController(preview,context),execution:context=>createOperationalAssistantExecutionController(operational,context)},webChatConnectionControllers:{list:context=>createListWebChatConnectionsController(webChatConnectionService,context),create:context=>createWebChatConnectionController(webChatConnectionService,context),get:context=>createGetWebChatConnectionController(webChatConnectionService,context),update:context=>createUpdateWebChatConnectionController(webChatConnectionService,context)},metaEmbeddedSignupControllers,whatsAppConnectionControllers:{list:context=>createListWhatsAppConnectionsController(whatsAppConnectionService,context),create:context=>createWhatsAppConnectionController(whatsAppConnectionService,context),get:context=>createGetWhatsAppConnectionController(whatsAppConnectionService,context),update:context=>createUpdateWhatsAppConnectionController(whatsAppConnectionService,context),status:context=>createGetWhatsAppConnectionStatusController(whatsAppConnectionService,context),configureCredentials:context=>createConfigureWhatsAppCredentialsController(whatsAppConnectionService,context),validate:context=>createValidateWhatsAppConnectionController(whatsAppConnectionService,context),activate:context=>createActivateWhatsAppConnectionController(whatsAppConnectionService,context),deactivate:context=>createDeactivateWhatsAppConnectionController(whatsAppConnectionService,context)},knowledgeControllers:companyKnowledgeControllers});
}


export const authorizedCompaniesRouter = createProductionAuthorizedCompaniesRouter(agent);

export function createProductionAppRouters(execution: AssistantExecutionPort = agent): AppRouters {
  return { authorizedCompaniesRouter: createProductionAuthorizedCompaniesRouter(execution), billingRouter, chatRouter, companiesRouter, identityRouter, knowledgeRouter, publicWebChatRouter, scrapeRouter, ...(whatsAppWebhookRouter ? { whatsAppWebhookRouter } : {}), billingWebhookRouter, workspacesRouter, platformAdminRouter };
}
