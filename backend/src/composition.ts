import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AtlasAgent } from "./agents/atlas.js";
import { createChatController } from "./controllers/chatController.js";
import { createCompanyController, createListCompaniesController } from "./controllers/companyController.js";
import { createKnowledgeController } from "./controllers/knowledgeController.js";
import { createOnboardingController } from "./controllers/onboarding.js";
import { createScrapeController } from "./controllers/scrapeController.js";
import { firecrawlProvider } from "./providers/firecrawl.js";
import { geminiProvider } from "./providers/gemini.js";
import { companyRepository } from "./repositories/companyRepository.js";
import { knowledgeRepository } from "./repositories/knowledgeRepository.js";
import { FileMarkdownDebugStore } from "./repositories/markdownDebugRepository.js";
import { createChatRouter } from "./routes/chat.js";
import { createCompaniesRouter } from "./routes/companies.js";
import { createKnowledgeRouter } from "./routes/knowledge.js";
import { createOnboardingRouter } from "./routes/onboarding.js";
import { createScrapeRouter } from "./routes/scrape.js";
import { ChatService } from "./services/chatService.js";
import { CompanyService } from "./services/companyService.js";
import { KnowledgeService } from "./services/knowledgeService.js";
import { cleanMarkdown } from "./services/markdownCleaner.js";
import { OnboardingService } from "./services/onboardingService.js";
import { ScrapeService } from "./services/scrapeService.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
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

export const chatRouter = createChatRouter(createChatController(chatService));
export const companiesRouter = createCompaniesRouter(
  createListCompaniesController(companyService),
  createCompanyController(companyService)
);
export const knowledgeRouter = createKnowledgeRouter(createKnowledgeController(knowledgeService));
export const onboardingRouter = createOnboardingRouter(createOnboardingController(onboardingService));
export const scrapeRouter = createScrapeRouter(createScrapeController(scrapeService));
