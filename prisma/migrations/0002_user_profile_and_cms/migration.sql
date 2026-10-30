CREATE TABLE "UserProfile" (
 "id" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "phone" TEXT,
 "company" TEXT,
 "jobTitle" TEXT,
 "website" TEXT,
 "location" TEXT,
 "bio" TEXT,
 "avatarUrl" TEXT,
 "timezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
 "locale" TEXT NOT NULL DEFAULT 'vi-VN',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "SitePage" (
 "id" TEXT NOT NULL,
 "slug" TEXT NOT NULL,
 "title" TEXT NOT NULL,
 "content" JSONB NOT NULL,
 "status" "PostStatus" NOT NULL DEFAULT 'DRAFT',
 "metaTitle" TEXT,
 "metaDescription" TEXT,
 "canonicalUrl" TEXT,
 "ogTitle" TEXT,
 "ogDescription" TEXT,
 "ogImageUrl" TEXT,
 "robots" TEXT NOT NULL DEFAULT 'index,follow',
 "schemaJson" JSONB,
 "publishedAt" TIMESTAMP(3),
 "updatedAt" TIMESTAMP(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SitePage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SitePage_slug_key" ON "SitePage"("slug");
CREATE INDEX "SitePage_status_publishedAt_idx" ON "SitePage"("status","publishedAt");
