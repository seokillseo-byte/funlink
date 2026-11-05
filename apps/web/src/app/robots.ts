import type {MetadataRoute} from "next";
import {absoluteSiteUrl} from "../lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard",
          "/profile",
          "/login",
          "/register",
          "/forgot-password",
          "/reset-password",
          "/verify-email",
          "/resend-verification",
          "/accept-invitation",
          "/billing",
          "/admin",
          "/api/"
        ]
      }
    ],
    sitemap: absoluteSiteUrl("/sitemap.xml"),
    host: absoluteSiteUrl("/")
  };
}
