export const siteUrl = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://funlink.io.vn");

export function absoluteSiteUrl(path = "/"): string {
  return new URL(path, siteUrl).toString();
}
