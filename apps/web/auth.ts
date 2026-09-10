import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { db } from "./lib/db";
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [GitHub({ authorization: { params: { scope: "read:user" } } })],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account?.provider === "github" && profile) {
        const id = "github:" + String(profile.id);
        await db()`INSERT INTO atlas.users(id,name) VALUES(${id},${String(profile.login || profile.name || "GitHub")}) ON CONFLICT(id) DO UPDATE SET name=excluded.name`;
        token.sub = id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
