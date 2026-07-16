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
import { createRegistrationController, createResendVerificationController, createVerifyEmailController } from "./controllers/identityController.js";
import { database } from "./config/database.js";
import { DevelopmentVerificationDelivery, UnavailableVerificationDelivery } from "./identity/infrastructure/developmentVerificationDelivery.js";
import { SecureRandomProvider, Sha256VerificationHashProvider } from "./identity/infrastructure/securityProviders.js";
import { SystemClock } from "./identity/infrastructure/systemClock.js";
import { RegistrationService } from "./identity/services/registrationService.js";
import { ResendEmailVerificationService } from "./identity/services/resendEmailVerificationService.js";
import { VerifyEmailService } from "./identity/services/verifyEmailService.js";
import { SqliteIdentityTransaction } from "./repositories/identityTransaction.js";
import { createIdentityRouter } from "./routes/identity.js";
import { firecrawlProvider } from "./providers/firecrawl.js";
import { geminiProvider } from "./providers/gemini.js";
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

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workspaceContext = createWorkspaceContext(workspaceRepository.resolveDefault());
const agent = new AtlasAgent(geminiProvider);
const chatService = new ChatService(companyRepository, knowledgeRepository, agent);
const companyService = new CompanyService(companyRepository);
const knowledgeService = new KnowledgeService(knowledgeRepository);
const scrapeService = new ScrapeService(firecrawlProvider);
const onboardingService = new OnboardingService(
  companyRepository,
  knowledgeRepository,
  firecrawlProvider,
  geminiProvider,
  cleanMarkdown,
  new FileMarkdownDebugStore(resolve(repositoryRoot, "knowledge"))
);

const identityTransaction = new SqliteIdentityTransaction(database);
const randomProvider = new SecureRandomProvider();
const verificationHashProvider = new Sha256VerificationHashProvider();
const identityClock = new SystemClock();
const deliverySelection = process.env.ATLAS_VERIFICATION_DELIVERY;
const verificationDelivery = deliverySelection === "development"
  ? new DevelopmentVerificationDelivery(process.env.NODE_ENV ?? "", (message) => console.info(message))
  : new UnavailableVerificationDelivery();
const verificationOrigin = process.env.ATLAS_VERIFICATION_ORIGIN ?? "http://localhost:3000";
const verificationLifetimeMilliseconds = 24 * 60 * 60 * 1000;
const verificationCooldownMilliseconds = 60 * 1000;
const registrationService = new RegistrationService(identityTransaction, randomProvider, verificationHashProvider,
  identityClock, verificationDelivery, verificationOrigin, verificationLifetimeMilliseconds);
const resendVerificationService = new ResendEmailVerificationService(identityTransaction, randomProvider,
  verificationHashProvider, identityClock, verificationDelivery, verificationOrigin,
  verificationLifetimeMilliseconds, verificationCooldownMilliseconds);
const verifyEmailService = new VerifyEmailService(identityTransaction, verificationHashProvider, identityClock);

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
});
