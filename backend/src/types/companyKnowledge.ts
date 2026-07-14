export interface CompanyKnowledge {
  company: {
    name: string;
    website: string;
    phone: string;
    email: string;
  };
  business: {
    services: string[];
    hours: string;
    locations: string[];
  };
  faq: Array<{
    question: string;
    answer: string;
  }>;
}
