export function authenticatedDestination(isPlatformAdmin: boolean): string { return isPlatformAdmin ? "/admin" : "/dashboard"; }
