export interface RequestOriginInput {
  readonly origin: string | undefined;
  readonly fetchSite: string | undefined;
  readonly effectiveProtocol: "http" | "https";
  readonly effectiveAuthority: string;
}

export interface RequestOriginPolicy {
  allows(input: RequestOriginInput): boolean;
}

export class ExactRequestOriginPolicy implements RequestOriginPolicy {
  private readonly allowedOrigins: ReadonlySet<string>;

  public constructor(origins: readonly string[], private readonly production: boolean) {
    this.allowedOrigins = new Set(origins.map((origin) => new URL(origin).origin));
  }

  public allows(input: RequestOriginInput): boolean {
    if (!input.origin || !input.effectiveAuthority) return false;
    if (input.fetchSite === "cross-site" || input.fetchSite === "same-site") return false;
    if (input.fetchSite !== undefined && input.fetchSite !== "same-origin" && input.fetchSite !== "none") return false;
    try {
      const origin = new URL(input.origin);
      if (this.production && (origin.protocol !== "https:" || input.effectiveProtocol !== "https")) return false;
      if (!this.allowedOrigins.has(origin.origin)) return false;
      return true;
    } catch {
      return false;
    }
  }
}

export interface EffectiveRequestAuthorityInput {
  readonly protocol: string;
  readonly host: string | undefined;
}

export interface EffectiveRequestAuthority {
  readonly protocol: "http" | "https";
  readonly authority: string;
}

export class EffectiveRequestAuthorityResolver {
  public resolve(input: EffectiveRequestAuthorityInput): EffectiveRequestAuthority | null {
    if ((input.protocol !== "http" && input.protocol !== "https") || !input.host) return null;
    try {
      const url = new URL(`${input.protocol}://${input.host}`);
      if (url.host !== input.host) return null;
      return { protocol: input.protocol, authority: url.host };
    } catch {
      return null;
    }
  }
}
