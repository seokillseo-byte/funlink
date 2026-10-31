import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const days = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 3650) {
    throw new Error(`${name} must be an integer between 1 and 3650`);
  }
  return value;
};

async function main() {
  const now = new Date();
  const authTokenCutoff = new Date(now.getTime() - days("AUTH_TOKEN_RETENTION_DAYS", 30) * 86400000);
  const sessionCutoff = new Date(now.getTime() - days("SESSION_RETENTION_DAYS", 30) * 86400000);
  const invitationCutoff = new Date(now.getTime() - days("INVITATION_RETENTION_DAYS", 90) * 86400000);

  // Keep recently expired/used records for support and abuse investigation.
  // Delete only records that are both terminal and older than the retention window.
  const [tokens, sessions, invitations] = await prisma.$transaction([
    prisma.authToken.deleteMany({
      where: {
        OR: [
          { usedAt: { not: null, lt: authTokenCutoff } },
          { expiresAt: { lt: authTokenCutoff } }
        ]
      }
    }),
    prisma.session.deleteMany({
      where: {
        OR: [
          { revokedAt: { not: null, lt: sessionCutoff } },
          { expiresAt: { lt: sessionCutoff } }
        ]
      }
    }),
    prisma.workspaceInvitation.deleteMany({
      where: {
        OR: [
          { acceptedAt: { not: null, lt: invitationCutoff } },
          { revokedAt: { not: null, lt: invitationCutoff } },
          { expiresAt: { lt: invitationCutoff } }
        ]
      }
    })
  ]);

  process.stdout.write(JSON.stringify({
    ok: true,
    deleted: {
      authTokens: tokens.count,
      sessions: sessions.count,
      workspaceInvitations: invitations.count
    },
    retentionDays: {
      authTokens: days("AUTH_TOKEN_RETENTION_DAYS", 30),
      sessions: days("SESSION_RETENTION_DAYS", 30),
      invitations: days("INVITATION_RETENTION_DAYS", 90)
    }
  }) + "\n");
}

main()
  .catch((error) => {
    process.stderr.write("Authentication data cleanup failed: " + String(error) + "\n");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
