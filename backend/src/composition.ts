import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
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
import { runtimeProductionConfiguration, sqlDatabase } from "./config/database.js";
import { mediaStorageAvailable } from "./config/productionConfiguration.js";
import { googleCloudSpeechConfiguration } from "./config/googleCloudSpeechConfiguration.js";
import { DevelopmentVerificationDelivery, UnavailableVerificationDelivery } from "./identity/infrastructure/developmentVerificationDelivery.js";
import { ScryptPasswordProvider, SecureRandomProvider, Sha256CredentialEnrollmentHashProvider, Sha256SessionIdentifierProvider, Sha256VerificationHashProvider } from "./identity/infrastructure/securityProviders.js";
import { SystemClock } from "./identity/infrastructure/systemClock.js";
import { RegistrationService } from "./identity/services/registrationService.js";
import { ResendEmailVerificationService } from "./identity/services/resendEmailVerificationService.js";
import { VerifyEmailService } from "./identity/services/verifyEmailService.js";
import { PasswordResetService } from "./identity/services/passwordResetService.js";
import { createAsyncIdentityPersistence } from "./identity/infrastructure/asyncIdentityFactory.js";
import { AuthenticationService } from "./identity/services/authenticationService.js";
import { createIdentityRouter } from "./routes/identity.js";
import { firecrawlProvider } from "./providers/firecrawl.js";
import { GeminiConversationIntelligenceDerivation, GeminiKnowledgeFactExtractor, geminiProvider } from "./providers/gemini.js";
import { ManualTextKnowledgeFactExtractor } from "./knowledge/services/manualTextKnowledgeFactExtractor.js";
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
import { createGetVoicePolicyController, createPutVoicePolicyController } from "./controllers/voicePolicyController.js";
import { VoicePolicyService } from "./whatsapp/services/voicePolicyService.js";
import { includeVoiceSemanticHistory, resolveVoiceSemanticMessage } from "./whatsapp/services/voiceSemanticContentResolver.js";
import { VoiceDeferredSemanticRecoveryService } from "./whatsapp/services/voiceDeferredSemanticRecoveryService.js";
import { createAsyncProactivePersistence } from "./proactive/infrastructure/asyncProactiveFactory.js";
import { ProactiveDueWorkerService } from "./proactive/services/proactiveDueWorkerService.js";
import { ProactiveRuntimeService } from "./proactive/services/proactiveRuntimeService.js";
import { ProactiveSemanticRecoveryService } from "./proactive/services/proactiveSemanticRecoveryService.js";
import { ProactiveActionOperatorService } from "./proactive/services/proactiveActionOperatorService.js";
import { createProactiveActionControllers } from "./controllers/proactiveActionController.js";
import {createWorkspaceAdministrationControllers}from"./controllers/workspaceAdministrationController.js";
import{createWorkspacesRouter}from"./routes/workspaces.js";
import{DevelopmentInvitationDelivery,SecureInvitationProofProvider,UnavailableInvitationDelivery}from"./workspace/infrastructure/invitationProviders.js";
import{WorkspaceAdministrationService}from"./workspace/services/workspaceAdministrationService.js";
import{AuthorizationService}from"./workspace/services/authorizationService.js";
import { SqlWorkspaceAdministrationTransaction } from "./workspace/infrastructure/asyncWorkspaceAdministrationTransaction.js";
import{WorkspaceResolver}from"./workspace/services/workspaceResolver.js";
import{configureProductionActivationService,configureProductionCompanyOperationalStatusService,configureProductionPilotReadinessService,configureProductionProactiveActionControllers,configureProductionSchedulingConfigurationService,configureProductionVoicePolicyControllers,createAuthorizedCompaniesRouter}from"./routes/authorizedCompanies.js";
import{AssistantProfileService}from"./assistant/services/assistantProfileService.js";
import{createAssistantProfileController,createGetAssistantProfileController,createListAssistantProfilesController,createTransitionAssistantProfileController,createUpdateAssistantProfileController}from"./controllers/assistantProfileController.js";
import { AssistantPreviewService } from "./assistant/services/assistantPreviewService.js";
import { createAssistantPreviewController } from "./controllers/assistantPreviewController.js";
import { ExactRequestOriginPolicy } from "./identity/infrastructure/requestOriginPolicy.js";
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
import { AsyncPlatformBootstrapService } from "./identity/services/asyncPlatformBootstrapService.js";
import { createAsyncConversationRuntimePersistence } from "./conversation/infrastructure/asyncConversationFactory.js";
import { ConversationService } from "./conversation/services/conversationService.js";
import { OperationalAssistantRuntime } from "./assistant/services/operationalAssistantRuntime.js";
import { InMemoryConversationTurnLock, OperationalConversationTurnService } from "./assistant/services/operationalConversationTurnService.js";
import { WebChatConnectionService } from "./webChat/services/webChatConnectionService.js";
import { createGetWebChatConnectionController, createListWebChatConnectionsController, createUpdateWebChatConnectionController, createWebChatConnectionController } from "./controllers/webChatConnectionController.js";
import { PublicWebChatSessionService } from "./webChat/services/publicWebChatSessionService.js";
import { PublicWebChatConversationService } from "./webChat/services/publicWebChatConversationService.js";
import { createAsyncWebChatPersistence } from "./webChat/infrastructure/asyncWebChatFactory.js";
import { createPublicWebChatRouter } from "./routes/publicWebChat.js";
import { WhatsAppWebhookService } from "./whatsapp/services/WhatsAppWebhookService.js";
import { createWhatsAppWebhookControllers } from "./controllers/WhatsAppWebhookController.js";
import { createWhatsAppWebhookRouter } from "./routes/whatsAppWebhook.js";
import { WhatsAppCloudApiProvider } from "./whatsapp/providers/WhatsAppCloudApiProvider.js";
import { MetaInboundMediaProvider } from "./whatsapp/providers/MetaInboundMediaProvider.js";
import { MetaOutboundMediaUploadProvider } from "./whatsapp/providers/MetaOutboundMediaUploadProvider.js";
import { GoogleCloudSpeechProvider } from "./whatsapp/providers/GoogleCloudSpeechProvider.js";
import { whatsAppCredentialCipherFromEnvironment } from "./whatsapp/infrastructure/aesGcmWhatsAppCredentialCipher.js";
import { AsyncWhatsAppCredentialResolver } from "./whatsapp/services/AsyncWhatsAppCredentialResolver.js";
import { WhatsAppConnectionService } from "./whatsapp/services/WhatsAppConnectionService.js";
import { WhatsAppOutboundDeliveryService } from "./whatsapp/services/WhatsAppOutboundDeliveryService.js";
import { AsyncWhatsAppDeliveryStatusService } from "./whatsapp/services/AsyncWhatsAppDeliveryStatusService.js";
import { MetaDeliveryStatusMapper } from "./whatsapp/services/MetaDeliveryStatusMapper.js";
import { DeliveryLifecyclePolicy } from "./transport/domain/providerDelivery.js";
import { OperatorConversationMessagingService } from "./conversation/services/operatorConversationMessagingService.js";
import { createOperatorConversationMessageController } from "./controllers/operatorConversationMessagingController.js";
import { configureProductionAssistantReadinessControllers, configureProductionCompanyCoreControllers, configureProductionConversationMessageController, configureProductionConversationReadControllers, configureProductionConversationControlControllers, configureProductionDefaultAssistantControllers } from "./routes/authorizedCompanies.js";
import { createGetConversationController, createListConversationController, createMarkConversationReadController } from "./controllers/conversationReadController.js";
import { createVoicePlaybackController, createVoiceReadController } from "./controllers/voiceReadController.js";
import { VoiceReadService } from "./whatsapp/services/voiceReadService.js";
import { ConversationControlService } from "./conversation/services/conversationControlService.js";
import { createConversationControlController } from "./controllers/conversationControlController.js";
import { createConversationEventFeedController } from "./controllers/conversationEventFeedController.js";
import { ConversationEventFeedService } from "./conversation/services/conversationEventFeedService.js";
import { createActivateWhatsAppConnectionController, createConfigureWhatsAppCredentialsController, createDeactivateWhatsAppConnectionController, createGetWhatsAppConnectionController, createGetWhatsAppConnectionStatusController, createListWhatsAppConnectionsController, createUpdateWhatsAppConnectionController, createValidateWhatsAppConnectionController, createWhatsAppConnectionController } from "./controllers/WhatsAppConnectionController.js";
import { CompanyApplicationService } from "./company/application/companyApplicationService.js";
import { createAsyncWorkspaceCompanyPersistence } from "./company/infrastructure/asyncCompanyFactory.js";
import { createCompanyCoreControllers } from "./controllers/companyCoreController.js";
import { AssistantReadinessService } from "./assistant/services/assistantReadinessService.js";
import { DefaultAssistantService } from "./assistant/services/defaultAssistantService.js";
import { createGetDefaultAssistantController, createPutDefaultAssistantController } from "./controllers/defaultAssistantController.js";
import { createGetAssistantReadinessController, createRefreshAssistantReadinessController } from "./controllers/assistantReadinessController.js";
import { PlatformAuthorizationService } from "./platformAdmin/services/platformAuthorizationService.js";
import { AsyncPlatformAdministrationService } from "./platformAdmin/services/asyncPlatformAdministrationService.js";
import { PlatformPilotReadinessService } from "./platformAdmin/services/platformPilotReadinessService.js";
import { createAsyncPlatformPilotReadinessPersistence } from "./platformAdmin/infrastructure/asyncPlatformPilotReadinessPersistence.js";
import { createPlatformAdminControllers } from "./controllers/platformAdminController.js";
import { createPlatformPilotReadinessController } from "./controllers/platformPilotReadinessController.js";
import { createPlatformAdminRouter } from "./routes/platformAdmin.js";
import { configureProductionAssistantCapabilityControllers, configureProductionCommercialControls } from "./routes/authorizedCompanies.js";
import { AsyncCommercialControlsRepository, AsyncPlatformAdministrationRepository, AsyncPlatformAdministratorRepository } from "./platformAdmin/infrastructure/asyncPlatformAdministrationPersistence.js";
import { createBillingEntitlementService } from "./billing/services/billingEntitlementService.js";
import { createAsyncAssistantPersistence } from "./assistant/infrastructure/asyncAssistantFactory.js";
import { createAsyncKnowledgePersistence } from "./knowledge/infrastructure/asyncKnowledgeFactory.js";
import { productionAssistantCapabilityCatalog } from "./assistant/domain/assistantCapability.js";
import { AssistantCapabilityService } from "./assistant/services/assistantCapabilityService.js";
import { AssistantCapabilityCatalogService } from "./assistant/services/assistantCapabilityCatalogService.js";
import { AssistantToolCatalogService } from "./assistant/services/assistantToolCatalogService.js";
import { createListAssistantCapabilitiesController, createListAssistantCapabilityCatalogController, createListAssistantToolCatalogController, createReplaceAssistantCapabilitiesController } from "./controllers/assistantCapabilityController.js";
import { ToolRegistry } from "./assistant/application/toolRegistry.js";
import { NoIntegrationToolAvailabilityPolicy } from "./assistant/application/toolContracts.js";
import { IntegrationToolAvailabilityPolicy } from "./integrations/services/integrationToolAvailabilityPolicy.js";
import { IntegrationConnectionRepository } from "./repositories/integrationConnectionRepository.js";
import { integrationSecretCipherRingFromEnvironment } from "./integrations/infrastructure/aesGcmIntegrationSecretCipher.js";
import { googleCalendarAccessTokenProviderFromEnvironment } from "./integrations/providers/googleCalendarAccessTokenProvider.js";
import { AssistantToolOrchestrator } from "./assistant/services/assistantToolOrchestrator.js";
import { ToolExecutionService } from "./assistant/services/toolExecutionService.js";
import { ConversationIntelligenceService } from "./conversationIntelligence/services/conversationIntelligenceService.js";
import { ConversationToolMemoryCoordinator } from "./conversationIntelligence/services/conversationToolMemoryCoordinator.js";
import { FakeLiveDataProvider } from "./liveData/infrastructure/fakeLiveDataProvider.js";
import { LiveDataService } from "./liveData/services/liveDataService.js";
import { LiveDataToolAvailabilityPolicy } from "./liveData/services/liveDataToolAvailabilityPolicy.js";
import { LiveDataObservationRepository } from "./repositories/liveDataObservationRepository.js";
import { liveDataReadToolDefinition } from "./liveData/application/liveDataReadToolDefinition.js";
import { BookingCommandService } from "./scheduling/services/bookingCommandService.js";
import { BookingQueryService } from "./scheduling/services/bookingQueryService.js";
import { schedulingBookingToolDefinitions } from "./scheduling/application/bookingToolDefinitions.js";
import { createAsyncLocalMediaCore, createAsyncMediaCore } from "./media/composition.js";
import { createAsyncMediaPersistence } from "./media/infrastructure/asyncMediaFactory.js";
import { S3MediaStorage } from "./media/infrastructure/s3MediaStorage.js";
import { UnavailableMediaStorage } from "./media/infrastructure/unavailableMediaStorage.js";
import { SafeConversationAttachmentService } from "./media/services/safeConversationAttachmentService.js";
import { WhatsAppInboundMediaRecoveryService } from "./whatsapp/services/WhatsAppInboundMediaRecoveryService.js";
import { VoiceTranscriptionWorkerService } from "./whatsapp/services/voiceTranscriptionWorkerService.js";
import { VoiceSynthesisWorkerService } from "./whatsapp/services/voiceSynthesisWorkerService.js";
import { VoiceMediaUploadWorkerService } from "./whatsapp/services/voiceMediaUploadWorkerService.js";
import { VoiceWorkerRecoveryService, voiceWorkerOptions } from "./whatsapp/services/voiceWorkerRecoveryService.js";
import { ProviderAdapterRegistry, RegistryIntegrationProviderValidator } from "./integrations/application/providerAdapterRegistry.js";
import { ScopedExternalProviderCredentialResolver } from "./integrations/services/scopedExternalProviderCredentialResolver.js";
import { IntegrationConnectionService } from "./integrations/services/integrationConnectionService.js";
import { GoogleCalendarValidationHttpTransport, GoogleCalendarValidationProvider } from "./integrations/providers/googleCalendarValidationProvider.js";
import { GoogleCalendarFreeBusyProvider } from "./integrations/providers/googleCalendarFreeBusyProvider.js";
import { GoogleCalendarEventsProvider } from "./integrations/providers/googleCalendarEventsProvider.js";
import { GoogleCalendarHttpTransport } from "./integrations/providers/googleCalendarTransport.js";
import { metaEmbeddedSignupProviderFromEnvironment } from "./whatsapp/providers/MetaEmbeddedSignupProvider.js";
import { MetaWhatsAppIntegrationValidationProvider } from "./whatsapp/application/metaEmbeddedSignupIntegration.js";
import { ExternalCalendarBindingService } from "./scheduling/services/externalCalendarBindingService.js";
import { ExternalBusyRefreshService } from "./scheduling/services/externalBusyRefreshService.js";
import { ExternalBookingCreateService } from "./scheduling/services/externalBookingCreateService.js";
import { ExternalBookingCancelService, ExternalBookingRescheduleService } from "./scheduling/services/externalBookingMutationServices.js";
import { SchedulingBookingRouter } from "./scheduling/services/schedulingBookingRouter.js";
import { SchedulingService } from "./scheduling/services/schedulingService.js";
import { SchedulingConfigurationService } from "./scheduling/services/schedulingConfigurationService.js";
import { createAsyncSchedulingPersistence } from "./scheduling/infrastructure/asyncSchedulingFactory.js";
import { billingProviderRegistryFromEnvironment } from "./billing/application/billingProviderConfiguration.js";
import { BillingOperationService } from "./billing/application/billingOperationService.js";
import { BillingPayerIdentityResolver } from "./billing/application/billingPayerIdentityResolver.js";
import { BillingAccountRepository, BillingCatalogRepository, BillingSubscriptionRepository } from "./repositories/billingRepository.js";
import { BillingOperationRepository } from "./repositories/billingOperationRepository.js";
import { BillingWebhookRepository } from "./repositories/billingWebhookRepository.js";
import { AsyncBillingWebhookService } from "./billing/application/billingWebhookService.js";
import { AsyncBillingReconciliationWorker } from "./billing/services/asyncBillingReconciliationWorker.js";
import { AsyncBillingOperationRecoveryWorker } from "./billing/services/asyncBillingOperationRecoveryWorker.js";
import { BillingReconciliationRuntime, billingReconciliationRuntimeConfiguration } from "./billing/services/billingReconciliationRuntime.js";
import { createBillingWebhookController } from "./controllers/billingWebhookController.js";
import { createBillingWebhookRouter } from "./routes/billingWebhook.js";
import { BillingApplicationService } from "./billing/application/billingApplicationService.js";
import { createBillingControllers } from "./controllers/billingController.js";
import { createBillingRouter } from "./routes/billing.js";
import { createAsyncBillingPersistence } from "./billing/infrastructure/asyncBillingFactory.js";
import { createAsyncBillingPilotReadinessPersistence } from "./billing/infrastructure/asyncBillingPilotReadiness.js";

import { HmacMetaEmbeddedSignupDigestProvider, MetaEmbeddedSignupAttemptService, metaEmbeddedSignupStateHmacKeyFromEnvironment } from "./whatsapp/application/metaEmbeddedSignupAttemptService.js";
import { StructuredMetaEmbeddedSignupAudit } from "./whatsapp/application/metaEmbeddedSignupAudit.js";
import { MetaEmbeddedSignupCompletionService } from "./whatsapp/application/metaEmbeddedSignupCompletionService.js";
import { MetaWhatsAppReadinessService } from "./whatsapp/application/metaWhatsAppReadinessService.js";
import { MetaEmbeddedSignupHttpService, embeddedSignupPublicConfig } from "./whatsapp/application/metaEmbeddedSignupHttpService.js";
import { createMetaEmbeddedSignupControllers } from "./controllers/metaEmbeddedSignupController.js";
import { CompanyOperationalStatusService } from "./company/services/companyOperationalStatusService.js";
import { PilotReadinessService } from "./onboarding/services/pilotReadinessService.js";
import { ActivationService } from "./activation/services/activationService.js";
import { createAsyncActivationVerificationPersistence } from "./activation/infrastructure/asyncActivationFactory.js";
import { createAsyncWhatsAppPersistence } from "./whatsapp/infrastructure/asyncWhatsAppFactory.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runtimeConfiguration = runtimeProductionConfiguration;
const googleCloudSpeechCredentials = googleCloudSpeechConfiguration();
const agent = new AtlasAgent(geminiProvider);
const scrapeService = new ScrapeService(firecrawlProvider);
const asyncWorkspaceCompanyPersistence = createAsyncWorkspaceCompanyPersistence(sqlDatabase);
const defaultWorkspaceContext = async (): Promise<WorkspaceContext> => createWorkspaceContext(await asyncWorkspaceCompanyPersistence.workspaces.resolveDefault());
const withDefaultWorkspaceContext = (factory: (context: WorkspaceContext) => import("express").RequestHandler): import("express").RequestHandler => async (request, response, next) => {
  try { await factory(await defaultWorkspaceContext())(request, response, next); }
  catch (error: unknown) { next(error); }
};
const billingPersistence = createAsyncBillingPersistence(sqlDatabase);
const billingEntitlements = createBillingEntitlementService(billingPersistence.entitlements, createAsyncBillingPilotReadinessPersistence(sqlDatabase));
const companyService = new CompanyService(asyncWorkspaceCompanyPersistence.legacyCompanies, billingEntitlements);
configureProductionCompanyCoreControllers(createCompanyCoreControllers(new CompanyApplicationService(asyncWorkspaceCompanyPersistence.companies, { entitlements: billingEntitlements })));
const assistantPersistence = createAsyncAssistantPersistence(sqlDatabase);
const knowledgePersistence = createAsyncKnowledgePersistence(sqlDatabase);
const conversationPersistence = createAsyncConversationRuntimePersistence(sqlDatabase);
const webChatPersistence = createAsyncWebChatPersistence(sqlDatabase);
const activationVerificationPersistence = createAsyncActivationVerificationPersistence(sqlDatabase);
const whatsAppPersistence = createAsyncWhatsAppPersistence(sqlDatabase);
const proactivePersistence = createAsyncProactivePersistence(sqlDatabase);
const schedulingPersistence = createAsyncSchedulingPersistence(sqlDatabase);
const mediaPersistence = createAsyncMediaPersistence(sqlDatabase);
const chatService = new ChatService(asyncWorkspaceCompanyPersistence.legacyCompanies, knowledgePersistence.knowledge, agent);
const knowledgeService = new KnowledgeService(knowledgePersistence.knowledge);
const identityPersistence = createAsyncIdentityPersistence(sqlDatabase);
const identityTransaction = identityPersistence.identityTransaction;
const randomProvider = new SecureRandomProvider();
const verificationHashProvider = new Sha256VerificationHashProvider();
const identityClock = new SystemClock();
const rateLimits = new RateLimitService(new SharedRateLimitRepository(sqlDatabase), () => identityClock.now());
export const billingProviderRegistry = billingProviderRegistryFromEnvironment();
export const billingOperationService = new BillingOperationService(billingPersistence.customer,billingPersistence.operations,billingProviderRegistry,()=>identityClock.now(),billingPersistence.payerIdentities);
export const billingWebhookService = new AsyncBillingWebhookService({stripe:process.env.STRIPE_WEBHOOK_SIGNING_SECRET?.trim() ?? "",mercadopago:process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim() ?? ""},billingPersistence.providerEvents,()=>identityClock.now());
export const billingReconciliationWorker = new AsyncBillingReconciliationWorker(billingPersistence.reconciliationWorker,billingProviderRegistry,()=>identityClock.now());
export const billingOperationRecoveryWorker = new AsyncBillingOperationRecoveryWorker(billingPersistence.operationRecovery,billingProviderRegistry,()=>identityClock.now());
export const billingReconciliationRuntime = new BillingReconciliationRuntime(billingReconciliationWorker, billingReconciliationRuntimeConfiguration(),{},billingOperationRecoveryWorker);
const production=process.env.NODE_ENV==="production";
const mediaAvailable=mediaStorageAvailable(runtimeConfiguration);
export const mediaCore = runtimeConfiguration
  ? createAsyncMediaCore(sqlDatabase, runtimeConfiguration.mediaStorage ? new S3MediaStorage(runtimeConfiguration.mediaStorage) : new UnavailableMediaStorage(), identityClock, mediaPersistence)
  : createAsyncLocalMediaCore(sqlDatabase, resolve(repositoryRoot, "media"), identityClock, mediaPersistence);
export const mediaRecoveryService = mediaCore.recovery;
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
const billingApplicationService = new BillingApplicationService(billingPersistence.customer,billingPersistence.payerIdentities,billingOperationService, { checkoutSuccess:billingReturnUrl("/billing/checkout/success"), checkoutCancel:billingReturnUrl("/billing/checkout/cancel"), portalReturn:billingReturnUrl("/billing/portal/return") },()=>identityClock.now());
const verificationLifetimeMilliseconds = 24 * 60 * 60 * 1000;
const verificationCooldownMilliseconds = 60 * 1000;
const passwordProvider = new ScryptPasswordProvider();
const registrationService = new RegistrationService(identityTransaction, randomProvider, verificationHashProvider,
  identityClock, verificationDelivery, verificationOrigin, verificationLifetimeMilliseconds, passwordProvider);
const resendVerificationService = new ResendEmailVerificationService(identityTransaction, randomProvider,
  verificationHashProvider, identityClock, verificationDelivery, verificationOrigin,
  verificationLifetimeMilliseconds, verificationCooldownMilliseconds);
const verifyEmailService = new VerifyEmailService(identityTransaction, verificationHashProvider, identityClock);
const authenticationTransaction = identityPersistence.authenticationTransaction;
const platformAdministrators = new AsyncPlatformAdministratorRepository(sqlDatabase);
const platformAuthorizationService = new PlatformAuthorizationService(platformAdministrators);
const authenticationService=new AuthenticationService(authenticationTransaction,randomProvider,new Sha256CredentialEnrollmentHashProvider(),passwordProvider,new Sha256SessionIdentifierProvider(),identityClock,verificationDelivery,verificationOrigin,process.env.NODE_ENV==="production",platformAdministrators);
const passwordResetControllers = createPasswordResetControllers(new PasswordResetService(authenticationTransaction, randomProvider, verificationHashProvider, passwordProvider, identityClock, verificationDelivery, verificationOrigin), rateLimits);
const requestOriginPolicy=new ExactRequestOriginPolicy(production?[verificationOrigin]:[verificationOrigin,"http://localhost:5173"],production);
const authenticationControllers=createAuthenticationControllers(authenticationService,requestOriginPolicy,rateLimits);
const invitationDelivery=deliveryMode==="development"?new DevelopmentInvitationDelivery(process.env.NODE_ENV??"development",message=>console.info(message)):providerDelivery??new UnavailableInvitationDelivery();
const workspaceAdministrationService=new WorkspaceAdministrationService(new SqlWorkspaceAdministrationTransaction(sqlDatabase),new SecureInvitationProofProvider(),identityClock,invitationDelivery,verificationOrigin,undefined,rateLimits);
configureProductionCommercialControls(new AsyncCommercialControlsRepository(sqlDatabase));
const platformBootstrapService = new AsyncPlatformBootstrapService(sqlDatabase, randomProvider,
  new ScryptPasswordProvider(), new Sha256SessionIdentifierProvider(), identityClock, process.env.ATLAS_BOOTSTRAP_SECRET ?? "");
const platformBootstrapControllers = createPlatformBootstrapControllers(platformBootstrapService, authenticationService);
export const authorizationService=new AuthorizationService(asyncWorkspaceCompanyPersistence.memberships,asyncWorkspaceCompanyPersistence.workspaces);
export const authenticatedWorkspaceResolver=new WorkspaceResolver(asyncWorkspaceCompanyPersistence.workspaces);
const assistantProfileService=new AssistantProfileService(assistantPersistence.profiles,identityClock,billingEntitlements);
const assistantCapabilityRepository=assistantPersistence.capabilities;
const integrationConnections = new IntegrationConnectionRepository(sqlDatabase);
export const integrationSecretCipher = integrationSecretCipherRingFromEnvironment();
export const googleCalendarAccessTokenProvider = googleCalendarAccessTokenProviderFromEnvironment(process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID, process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET);
export const metaEmbeddedSignupProvider = metaEmbeddedSignupProviderFromEnvironment();
export const providerAdapterRegistry = new ProviderAdapterRegistry();
const externalCalendarRepository = schedulingPersistence.externalCalendar;
const schedulingRepository = schedulingPersistence.scheduling;
const schedulingConfigurationService = new SchedulingConfigurationService(schedulingPersistence.configuration, identityClock);
configureProductionSchedulingConfigurationService(schedulingConfigurationService);
const externalCalendarBindingService = new ExternalCalendarBindingService(externalCalendarRepository, schedulingRepository, integrationConnections, identityClock);
const externalSchedulingService = new SchedulingService(schedulingRepository, identityClock);
const scopedExternalProviderCredentials = integrationSecretCipher ? new ScopedExternalProviderCredentialResolver(integrationConnections, integrationSecretCipher) : null;
if (integrationSecretCipher && googleCalendarAccessTokenProvider && scopedExternalProviderCredentials) providerAdapterRegistry.register({ provider: "google_calendar", kind: "calendar", validation: new GoogleCalendarValidationProvider(googleCalendarAccessTokenProvider, new GoogleCalendarValidationHttpTransport(), identityClock), calendarBusy: new GoogleCalendarFreeBusyProvider(scopedExternalProviderCredentials, googleCalendarAccessTokenProvider, new GoogleCalendarHttpTransport()), calendarEvents: new GoogleCalendarEventsProvider(scopedExternalProviderCredentials, googleCalendarAccessTokenProvider, new GoogleCalendarHttpTransport()) });
if (integrationSecretCipher && metaEmbeddedSignupProvider) providerAdapterRegistry.register({ provider: "meta_whatsapp", kind: "cloud_api", validation: new MetaWhatsAppIntegrationValidationProvider(metaEmbeddedSignupProvider) });
export const integrationConnectionService = integrationSecretCipher ? new IntegrationConnectionService(integrationConnections, integrationSecretCipher, new RegistryIntegrationProviderValidator(providerAdapterRegistry), identityClock) : null;
export const externalBusyRefreshService = new ExternalBusyRefreshService(externalCalendarBindingService, providerAdapterRegistry, schedulingRepository, identityClock);
const liveDataProvider = new FakeLiveDataProvider();
const liveDataService = new LiveDataService(new LiveDataObservationRepository(sqlDatabase), integrationConnections, liveDataProvider, identityClock);
const bookingRepository = schedulingPersistence.booking;
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
const assistantToolCatalogService=new AssistantToolCatalogService(assistantCapabilityRepository,productionToolRegistry,productionToolAvailability);
configureProductionAssistantCapabilityControllers({list:context=>createListAssistantCapabilitiesController(assistantCapabilityService,context),catalog:context=>createListAssistantCapabilityCatalogController(assistantCapabilityCatalogService,context),toolsCatalog:context=>createListAssistantToolCatalogController(assistantToolCatalogService,context),replace:(context,actor)=>createReplaceAssistantCapabilitiesController(assistantCapabilityService,context,actor)});
const productionAssistantTools=new AssistantToolOrchestrator(geminiProvider.toolModel(),productionToolRegistry,assistantCapabilityRepository,productionToolAvailability,new ToolExecutionService(conversationPersistence.toolTraces,identityClock),identityClock);
const webChatConnectionService = new WebChatConnectionService(asyncWorkspaceCompanyPersistence.legacyCompanies, assistantPersistence.profiles, webChatPersistence.connections, identityClock, billingEntitlements);
export const whatsAppCredentialCipher = whatsAppCredentialCipherFromEnvironment();
const asyncWhatsAppCredentialResolver = new AsyncWhatsAppCredentialResolver(whatsAppPersistence.connections, whatsAppCredentialCipher, process.env.WHATSAPP_ACCESS_TOKEN ?? "", integrationSecretCipher ? { repository: whatsAppPersistence.connections, cipher: integrationSecretCipher } : undefined);
export const whatsAppInboundMediaProvider = new MetaInboundMediaProvider(whatsAppPersistence.connections, asyncWhatsAppCredentialResolver, { graphVersion: process.env.WHATSAPP_GRAPH_API_VERSION ?? "v26.0" });
export const whatsAppInboundMediaRecoveryService = new WhatsAppInboundMediaRecoveryService(whatsAppPersistence.inboundMedia, whatsAppInboundMediaProvider, mediaCore.service, whatsAppPersistence.inboundMedia, identityClock, 60_000, googleCloudSpeechCredentials ? { kind: "available", repository: whatsAppPersistence.voice, maximumDurationMilliseconds: 120_000, createTranscriptionRequestId: () => `atr_${randomUUID().replaceAll("-", "")}` } : { kind: "unavailable" });
const defaultAssistantService = new DefaultAssistantService(assistantPersistence.profiles, assistantPersistence.defaults, identityClock);
configureProductionDefaultAssistantControllers({get:(context)=>createGetDefaultAssistantController(defaultAssistantService,context),put:(context,actor)=>createPutDefaultAssistantController(defaultAssistantService,context,actor.userId)});
const assistantReadinessService = new AssistantReadinessService(asyncWorkspaceCompanyPersistence.companies, knowledgePersistence.knowledge, assistantPersistence.profiles, whatsAppPersistence.connections, assistantPersistence.readiness, defaultAssistantService, identityClock);
configureProductionCompanyOperationalStatusService(new CompanyOperationalStatusService(asyncWorkspaceCompanyPersistence.companies, assistantPersistence.readiness, whatsAppPersistence.connections));
configureProductionAssistantReadinessControllers({ get: (context) => createGetAssistantReadinessController(assistantReadinessService, context), refresh: (context) => createRefreshAssistantReadinessController(assistantReadinessService, context) });
const whatsAppConnectionService = new WhatsAppConnectionService(asyncWorkspaceCompanyPersistence.legacyCompanies, assistantPersistence.profiles, whatsAppPersistence.connections, identityClock, { credentials: whatsAppPersistence.connections, states: whatsAppPersistence.connections, cipher: whatsAppCredentialCipher, resolver: asyncWhatsAppCredentialResolver, validator: new WhatsAppCloudApiProvider("", process.env.WHATSAPP_GRAPH_API_VERSION ?? "v26.0"), knowledge: knowledgePersistence.knowledge, linked: whatsAppPersistence.connections }, assistantReadinessService, billingEntitlements);
whatsAppConnectionService.setRateLimiter(rateLimits);
const googleCloudSpeech = googleCloudSpeechCredentials ? new GoogleCloudSpeechProvider(googleCloudSpeechCredentials) : null;
const transcriptionWorkerOptions = voiceWorkerOptions("voice-transcription"), synthesisWorkerOptions = voiceWorkerOptions("voice-synthesis"), uploadWorkerOptions = voiceWorkerOptions("voice-upload");
export const voiceWorkerRecoveryService = googleCloudSpeech ? new VoiceWorkerRecoveryService(whatsAppPersistence.voice, new VoiceTranscriptionWorkerService(whatsAppPersistence.voice, mediaCore.service, googleCloudSpeech, identityClock, { owner: transcriptionWorkerOptions.owner, batchSize: transcriptionWorkerOptions.batchSize, leaseMilliseconds: transcriptionWorkerOptions.leaseMilliseconds, transcriptionTimeoutMilliseconds: transcriptionWorkerOptions.timeoutMilliseconds, maximumDurationMilliseconds: 120_000, createTranscriptId: () => `cat_${randomUUID().replaceAll("-", "")}` }), new VoiceSynthesisWorkerService(whatsAppPersistence.voice, mediaCore.service, googleCloudSpeech, identityClock, { owner: synthesisWorkerOptions.owner, batchSize: synthesisWorkerOptions.batchSize, leaseMilliseconds: synthesisWorkerOptions.leaseMilliseconds, synthesisTimeoutMilliseconds: synthesisWorkerOptions.timeoutMilliseconds }), new VoiceMediaUploadWorkerService(whatsAppPersistence.voice, mediaCore.service, new MetaOutboundMediaUploadProvider(whatsAppPersistence.connections, asyncWhatsAppCredentialResolver, process.env.WHATSAPP_GRAPH_API_VERSION ?? "v26.0"), identityClock, { owner: uploadWorkerOptions.owner, batchSize: uploadWorkerOptions.batchSize, leaseMilliseconds: uploadWorkerOptions.leaseMilliseconds, uploadTimeoutMilliseconds: uploadWorkerOptions.timeoutMilliseconds })) : null;
const metaEmbeddedSignupAudit = new StructuredMetaEmbeddedSignupAudit();
const embeddedAttempts = metaEmbeddedSignupProvider && integrationConnectionService && process.env.META_EMBEDDED_SIGNUP_STATE_HMAC_KEY ? new MetaEmbeddedSignupAttemptService(whatsAppPersistence.metaEmbeddedSignupAttempts,new HmacMetaEmbeddedSignupDigestProvider(metaEmbeddedSignupStateHmacKeyFromEnvironment()),identityClock,600_000,metaEmbeddedSignupAudit) : null;
const embeddedCompletion = embeddedAttempts && metaEmbeddedSignupProvider && integrationConnectionService ? new MetaEmbeddedSignupCompletionService(embeddedAttempts,metaEmbeddedSignupProvider,integrationConnectionService,whatsAppPersistence.metaEmbeddedSignupFinalizer,identityClock,process.env.META_GRAPH_API_VERSION ?? "v26.0",metaEmbeddedSignupAudit) : null;
const embeddedReadiness = metaEmbeddedSignupProvider && integrationConnectionService ? new MetaWhatsAppReadinessService(whatsAppPersistence.connections,asyncWhatsAppCredentialResolver,integrationConnectionService,whatsAppConnectionService,metaEmbeddedSignupProvider,metaEmbeddedSignupAudit,identityClock): null;
const metaEmbeddedSignupControllers=createMetaEmbeddedSignupControllers(new MetaEmbeddedSignupHttpService(embeddedAttempts,embeddedCompletion,embeddedReadiness,assistantProfileService,whatsAppConnectionService,whatsAppPersistence.connections,embeddedAttempts ? embeddedSignupPublicConfig() : {available:false},rateLimits));
export const conversationService = new ConversationService(conversationPersistence.conversations, identityClock);
const publicWebChatSessionService = new PublicWebChatSessionService(webChatConnectionService, conversationService, webChatPersistence.sessions, identityClock, undefined, rateLimits);
const conversationIntelligenceService = new ConversationIntelligenceService(conversationPersistence.intelligence, new GeminiConversationIntelligenceDerivation(geminiProvider), identityClock);
const conversationToolMemory = new ConversationToolMemoryCoordinator(conversationPersistence.toolMemory, identityClock);
const knowledgeRetrievalService=new LexicalKnowledgeRetrievalService(knowledgePersistence.retrieval);
const voicePolicyService = new VoicePolicyService(whatsAppPersistence.voice, identityClock);
configureProductionVoicePolicyControllers({get:(context)=>createGetVoicePolicyController(voicePolicyService,context),put:(context,actor)=>createPutVoicePolicyController(voicePolicyService,context,actor)});
export const voiceDeferredSemanticRecoveryService = new VoiceDeferredSemanticRecoveryService(whatsAppPersistence.voice, conversationIntelligenceService);
const proactiveActions = proactivePersistence.actions;
const proactiveActionOperatorService = new ProactiveActionOperatorService(proactiveActions, identityClock, rateLimits);
configureProductionProactiveActionControllers(createProactiveActionControllers(proactiveActionOperatorService));
const pilotReadinessService=new PilotReadinessService(asyncWorkspaceCompanyPersistence.companies, assistantReadinessService, knowledgePersistence.knowledge, webChatPersistence.connections, whatsAppPersistence.connections, billingEntitlements, { whatsAppEmbeddedSignupAvailable: embeddedAttempts !== null && embeddedSignupPublicConfig().available }, identityClock, { scheduling: schedulingConfigurationService, proactive: proactiveActions });
configureProductionPilotReadinessService(pilotReadinessService);
const activationService=new ActivationService(asyncWorkspaceCompanyPersistence.companies,webChatPersistence.connections,pilotReadinessService,activationVerificationPersistence.verificationSettlements,identityClock);
configureProductionActivationService(activationService);
export const proactiveSemanticRecoveryService = new ProactiveSemanticRecoveryService(proactiveActions, conversationIntelligenceService);
const productionOperationalAssistantRuntime = new OperationalAssistantRuntime(agent, assistantPersistence.executionRecords, identityClock, productionAssistantTools);
export const proactiveDueWorkerService = new ProactiveDueWorkerService(proactiveActions, identityClock, new ProactiveRuntimeService(proactiveActions, asyncWorkspaceCompanyPersistence.legacyCompanies, knowledgePersistence.knowledge, assistantPersistence.profiles, conversationService, productionOperationalAssistantRuntime, identityClock, conversationIntelligenceService, knowledgeRetrievalService));
const voiceSemanticProjection = { resolveInbound: (context: WorkspaceContext, companyId: number, message: import("./conversation/domain/conversation.js").ConversationMessage) => resolveVoiceSemanticMessage(whatsAppPersistence.voice, context, companyId, message), includeHistory: (context: WorkspaceContext, companyId: number, message: import("./conversation/domain/conversation.js").ConversationMessage) => includeVoiceSemanticHistory(whatsAppPersistence.voice, context, companyId, message), applyAssistant: (context: WorkspaceContext, companyId: number, message: import("./conversation/domain/conversation.js").ConversationMessage) => includeVoiceSemanticHistory(whatsAppPersistence.voice, context, companyId, message) };
export const operationalConversationTurnService = new OperationalConversationTurnService(asyncWorkspaceCompanyPersistence.legacyCompanies, knowledgePersistence.knowledge, assistantPersistence.profiles, conversationService, productionOperationalAssistantRuntime, new InMemoryConversationTurnLock(), "gemini", 20, conversationIntelligenceService, conversationToolMemory, knowledgeRetrievalService, new SafeConversationAttachmentService(mediaPersistence.attachments), conversationPersistence.conversations, voiceSemanticProjection);
const publicWebChatConversationService = new PublicWebChatConversationService(publicWebChatSessionService, operationalConversationTurnService, conversationService, rateLimits, activationService, webChatPersistence.turns);
const knowledgeIndexingService=new KnowledgeIndexingService(knowledgePersistence.retrieval);
const companyKnowledgeService=new FrozenKnowledgeService(asyncWorkspaceCompanyPersistence.legacyCompanies,knowledgePersistence.knowledge,new SecurePublicUrlProvider(),new WorkerPdfTextExtractor(),new ManualTextKnowledgeFactExtractor(new GeminiKnowledgeFactExtractor(geminiProvider)),identityClock,undefined,knowledgeIndexingService);
const companyKnowledgeControllers=createCompanyKnowledgeControllers(companyKnowledgeService,rateLimits);
const onboardingService = new OnboardingService(asyncWorkspaceCompanyPersistence.legacyCompanies,knowledgePersistence.knowledge,firecrawlProvider,geminiProvider,cleanMarkdown,new FileMarkdownDebugStore(resolve(repositoryRoot,"knowledge")),companyKnowledgeService,rateLimits);

export const chatRouter = createChatRouter(withDefaultWorkspaceContext(context => createChatController(chatService, context)));
export const companiesRouter = createCompaniesRouter({
  list: withDefaultWorkspaceContext(context => createListCompaniesController(companyService, context)),
  create: withDefaultWorkspaceContext(context => createCompanyController(companyService, context)),
  get: withDefaultWorkspaceContext(context => createGetCompanyController(companyService, context)),
  update: withDefaultWorkspaceContext(context => createUpdateCompanyController(companyService, context)),
  delete: withDefaultWorkspaceContext(context => createDeleteCompanyController(companyService, context)),
  onboard: withDefaultWorkspaceContext(context => createOnboardingController(onboardingService, context, undefined, rateLimits)),
});
export const knowledgeRouter = createKnowledgeRouter(withDefaultWorkspaceContext(context => createKnowledgeController(knowledgeService, context)));
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
export const publicWebChatRouter = createPublicWebChatRouter(publicWebChatSessionService, publicWebChatConversationService, production, activationService);
export const whatsAppOutboundDeliveryService = new WhatsAppOutboundDeliveryService(conversationPersistence.conversations, whatsAppPersistence.connections, whatsAppPersistence.providerMessages, whatsAppPersistence.outboundDeliveries, asyncWhatsAppCredentialResolver, (accessToken) => new WhatsAppCloudApiProvider(accessToken, process.env.WHATSAPP_GRAPH_API_VERSION ?? "v26.0"), identityClock, whatsAppConnectionService, whatsAppPersistence.conversations, whatsAppPersistence.voice, voiceDeferredSemanticRecoveryService, proactiveSemanticRecoveryService);
const whatsAppDeliveryStatusService = new AsyncWhatsAppDeliveryStatusService(whatsAppPersistence.providerMessages, whatsAppPersistence.outboundDeliveries, new MetaDeliveryStatusMapper(), new DeliveryLifecyclePolicy(), identityClock);
const operatorConversationMessagingService = new OperatorConversationMessagingService(conversationService, conversationPersistence.conversations, conversationPersistence.conversations, whatsAppPersistence.conversations, whatsAppOutboundDeliveryService, identityClock, conversationIntelligenceService, rateLimits);
configureProductionConversationMessageController((context, actor) => createOperatorConversationMessageController(operatorConversationMessagingService, context, actor));
  const conversationEventFeedService = new ConversationEventFeedService(conversationPersistence.conversations);
  const voiceReadService = new VoiceReadService(whatsAppPersistence.voice, mediaCore.service);
  configureProductionConversationReadControllers({ list: (context, actor) => createListConversationController(conversationService, context, actor), get: (context, actor) => createGetConversationController(conversationService, context, actor), markRead: (context, actor) => createMarkConversationReadController(conversationService, context, actor), feed: (context) => createConversationEventFeedController(conversationEventFeedService, context), voice: (context) => createVoiceReadController(voiceReadService, context), ...(mediaAvailable ? { playback: (context: WorkspaceContext) => createVoicePlaybackController(voiceReadService, context) } : {}) });
const conversationControlService = new ConversationControlService(conversationService, conversationPersistence.conversations, identityClock);
configureProductionConversationControlControllers({ takeover: (context, actor) => createConversationControlController(conversationControlService, context, actor, "takeover"), release: (context, actor) => createConversationControlController(conversationControlService, context, actor, "release"), resolve: (context, actor) => createConversationControlController(conversationControlService, context, actor, "resolve"), resume: (context, actor) => createConversationControlController(conversationControlService, context, actor, "resume") });
export const whatsAppWebhookService = new WhatsAppWebhookService({ appSecret: process.env.WHATSAPP_APP_SECRET ?? "", verifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "" }, whatsAppConnectionService, undefined, undefined, conversationService, operationalConversationTurnService, identityClock, undefined, undefined, undefined, undefined, undefined, undefined, undefined, whatsAppDeliveryStatusService, whatsAppPersistence.inbound);
const whatsAppWebhookRouter = runtimeConfiguration && !runtimeConfiguration.whatsAppWebhookEnabled ? undefined : createWhatsAppWebhookRouter(createWhatsAppWebhookControllers(whatsAppWebhookService));
const billingWebhookRouter = createBillingWebhookRouter({stripe:createBillingWebhookController(billingWebhookService,"stripe"),mercadoPago:createBillingWebhookController(billingWebhookService,"mercadopago")});
export const workspacesRouter=createWorkspacesRouter(createWorkspaceAdministrationControllers(workspaceAdministrationService,authenticationService,requestOriginPolicy));
const billingRouter=createBillingRouter({authentication:authenticationService,users:identityPersistence.users as never,authorization:authorizationService,resolver:authenticatedWorkspaceResolver,originPolicy:requestOriginPolicy,controllers:createBillingControllers(billingApplicationService,rateLimits)});
const platformAdministrationRepository=new AsyncPlatformAdministrationRepository(sqlDatabase);
export const platformAdminRouter=createPlatformAdminRouter(authenticationService,platformAuthorizationService,{...createPlatformAdminControllers(new AsyncPlatformAdministrationService(platformAdministrationRepository,new AsyncCommercialControlsRepository(sqlDatabase),billingPersistence.catalogAdministration,billingProviderRegistry)),workspacePilotReadiness:createPlatformPilotReadinessController(new PlatformPilotReadinessService(createAsyncPlatformPilotReadinessPersistence(sqlDatabase),pilotReadinessService))} as never,requestOriginPolicy);
function createProductionAuthorizedCompaniesRouter(execution: AssistantExecutionPort) {
  const runtime = new OperationalAssistantRuntime(execution, assistantPersistence.executionRecords, identityClock, execution===agent?productionAssistantTools:undefined);
const preview = new AssistantPreviewService(asyncWorkspaceCompanyPersistence.legacyCompanies, knowledgePersistence.knowledge, assistantPersistence.profiles, runtime, "gemini", knowledgeRetrievalService, rateLimits);
  const operational = new OperationalAssistantExecutionService(asyncWorkspaceCompanyPersistence.legacyCompanies, knowledgePersistence.knowledge, assistantPersistence.profiles, runtime, new SharedOperationalExecutionBudget(new RateLimitService(new SharedRateLimitRepository(sqlDatabase), () => identityClock.now())), "gemini", knowledgeRetrievalService);
  return createAuthorizedCompaniesRouter({authentication:authenticationService,users:identityPersistence.users,authorization:authorizationService,resolver:authenticatedWorkspaceResolver,controllers:{list:context=>createListCompaniesController(companyService,context),create:context=>createCompanyController(companyService,context),get:context=>createGetCompanyController(companyService,context),update:context=>createUpdateCompanyController(companyService,context),delete:context=>createDeleteCompanyController(companyService,context),onboard:(context,actor)=>createOnboardingController(onboardingService,context,actor)},assistantControllers:{list:context=>createListAssistantProfilesController(assistantProfileService,context),create:context=>createAssistantProfileController(assistantProfileService,context),get:context=>createGetAssistantProfileController(assistantProfileService,context),update:context=>createUpdateAssistantProfileController(assistantProfileService,context),transition:context=>createTransitionAssistantProfileController(assistantProfileService,context),preview:context=>createAssistantPreviewController(preview,context),execution:context=>createOperationalAssistantExecutionController(operational,context)},webChatConnectionControllers:{list:context=>createListWebChatConnectionsController(webChatConnectionService,context),create:context=>createWebChatConnectionController(webChatConnectionService,context),get:context=>createGetWebChatConnectionController(webChatConnectionService,context),update:context=>createUpdateWebChatConnectionController(webChatConnectionService,context)},metaEmbeddedSignupControllers,whatsAppConnectionControllers:{list:context=>createListWhatsAppConnectionsController(whatsAppConnectionService,context),create:context=>createWhatsAppConnectionController(whatsAppConnectionService,context),get:context=>createGetWhatsAppConnectionController(whatsAppConnectionService,context),update:context=>createUpdateWhatsAppConnectionController(whatsAppConnectionService,context),status:context=>createGetWhatsAppConnectionStatusController(whatsAppConnectionService,context),configureCredentials:context=>createConfigureWhatsAppCredentialsController(whatsAppConnectionService,context),validate:context=>createValidateWhatsAppConnectionController(whatsAppConnectionService,context),activate:context=>createActivateWhatsAppConnectionController(whatsAppConnectionService,context),deactivate:context=>createDeactivateWhatsAppConnectionController(whatsAppConnectionService,context)},knowledgeControllers:companyKnowledgeControllers});
}


export const authorizedCompaniesRouter = createProductionAuthorizedCompaniesRouter(agent);

export function createProductionAppRouters(execution: AssistantExecutionPort = agent): AppRouters {
  return { authorizedCompaniesRouter: createProductionAuthorizedCompaniesRouter(execution), billingRouter, chatRouter, companiesRouter, identityRouter, knowledgeRouter, publicWebChatRouter, scrapeRouter, ...(whatsAppWebhookRouter ? { whatsAppWebhookRouter } : {}), billingWebhookRouter, workspacesRouter, platformAdminRouter };
}
