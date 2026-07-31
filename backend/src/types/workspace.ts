export interface Workspace {
  id: number;
  publicId: string;
  key: string;
  name: string;
  timezone: string | null;
  defaultLocale: "en" | "es" | null;
  createdAt: string;
}
