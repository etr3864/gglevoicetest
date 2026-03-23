import { prisma, Prisma } from '@voice/db';
import { embedQuery } from '../knowledge/embedding.service';
import type { MediaContext, MediaContextItem } from './types';

const MEDIA_INJECT_THRESHOLD = 15;
const SEARCH_CANDIDATES = 10;
const SEARCH_TOP_K = 3;

export async function getMediaContext(agentId: string): Promise<MediaContext> {
  const count = await prisma.mediaItem.count({ where: { agentId, status: 'ready' } });

  if (count === 0) return { hasMedia: false, totalCount: 0 };

  if (count <= MEDIA_INJECT_THRESHOLD) {
    const items = await prisma.mediaItem.findMany({
      where: { agentId, status: 'ready' },
      select: { id: true, mediaType: true, name: true, description: true, caption: true },
      orderBy: { createdAt: 'asc' },
    });
    return { hasMedia: true, totalCount: count, items: items as MediaContextItem[] };
  }

  return { hasMedia: true, totalCount: count };
}

export async function searchMedia(agentId: string, query: string): Promise<MediaContextItem | null> {
  const { vector } = await embedQuery(query);
  const vecStr = `[${vector.join(',')}]`;

  type RawRow = { id: string; media_type: string; name: string; description: string; caption: string | null; score: number };

  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL hnsw.iterative_scan = relaxed_order`;
    return tx.$queryRaw<RawRow[]>`
      WITH candidates AS (
        SELECT
          id, media_type, name, description, caption,
          1 - (embedding <=> ${vecStr}::vector) AS cosine
        FROM media_items
        WHERE agent_id = ${agentId}
          AND status = 'ready'
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${vecStr}::vector
        LIMIT ${SEARCH_CANDIDATES}
      )
      SELECT
        id, media_type, name, description, caption,
        (0.6 * cosine + 0.4 * similarity(name || ' ' || description, ${query})) AS score
      FROM candidates
      ORDER BY score DESC
      LIMIT ${SEARCH_TOP_K}
    `;
  });

  if (!rows || rows.length === 0 || rows[0].score < 0.35) return null;

  const top = rows[0];
  return {
    id: top.id,
    mediaType: top.media_type,
    name: top.name,
    description: top.description,
    caption: top.caption,
  };
}

export async function getMediaItemById(agentId: string, itemId: string) {
  return prisma.mediaItem.findFirst({
    where: { id: itemId, agentId, status: 'ready' },
    select: { id: true, mediaType: true, name: true, description: true, caption: true, gcsPath: true, mimeType: true },
  });
}
