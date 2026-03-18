import { Router } from 'express';
import { prisma } from '@voice/db';
import { authMiddleware, assertAgentAccess } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { getSignedUrl } from '../services/recording/recording.gcs';

const router = Router();

router.use(authMiddleware);

router.get('/agents/:agentId/calls/:callId/recording', async (req, res) => {
  const { agentId, callId } = req.params;
  const gcsPath = await getRecordingPath(agentId, callId, req.user!);
  const url = await getSignedUrl(gcsPath, false);
  res.json({ data: { url } });
});

router.get('/agents/:agentId/calls/:callId/recording/download', async (req, res) => {
  const { agentId, callId } = req.params;
  const gcsPath = await getRecordingPath(agentId, callId, req.user!);
  const url = await getSignedUrl(gcsPath, true);
  res.json({ data: { url } });
});

async function getRecordingPath(agentId: string, callId: string, user: Express.Request['user']): Promise<string> {
  await assertAgentAccess(agentId, user!);

  const call = await prisma.call.findFirst({ where: { id: callId, agentId } });
  if (!call) throw new AppError(404, 'NOT_FOUND', 'Call not found');
  if (!call.recordingUrl || call.recordingStatus !== 'ready') {
    throw new AppError(404, 'NOT_FOUND', 'Recording not available');
  }

  return call.recordingUrl;
}

export default router;
