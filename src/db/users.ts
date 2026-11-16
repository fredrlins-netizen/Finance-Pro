import { db } from './index.ts';
import { users } from './schema.ts';
import { eq, sql } from 'drizzle-orm';

export async function getOrCreateUser(uid: string, email: string, name?: string) {
  try {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const existing = cleanEmail
      ? await db
          .select()
          .from(users)
          .where(sql`lower(${users.email}) = ${cleanEmail}`)
          .limit(1)
      : [];

    if (existing.length > 0) {
      if (existing[0].suspended || !existing[0].active) {
        return existing[0];
      }
      if (existing[0].uid !== uid) {
        const updated = await db
          .update(users)
          .set({ uid, name: name || existing[0].name })
          .where(eq(users.id, existing[0].id))
          .returning();
        return updated[0];
      }
      return existing[0];
    }

    const result = await db
      .insert(users)
      .values({
        uid,
        email: cleanEmail || email,
        name: name || (cleanEmail || email).split('@')[0],
        role: 'admin',
        allowedUnitIds: [1, 2, 3, 4, 5, 6, 7],
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: cleanEmail || email,
          ...(name ? { name } : {}),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query failed in getOrCreateUser:', error);
    throw new Error('Falha ao sincronizar usuário no banco de dados.', { cause: error });
  }
}
