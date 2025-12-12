import fastify from 'fastify';
import fastifyWs from '@fastify/websocket';
import fastifyFormBody from '@fastify/formbody';
import { config } from './config/env';
import { StreamBridgeService } from './services/stream';

const server = fastify();

server.register(fastifyFormBody);
server.register(fastifyWs);

server.register(async (fastify) => {
  fastify.get('/media-stream', { websocket: true }, (connection, req) => {
    console.log('New WebSocket connection received from Twilio');
    // 'connection' here is the WebSocket (or SocketStream depending on types), 
    // casting to any to ensure compatibility with Service which expects 'ws' WebSocket.
    new StreamBridgeService(connection as any, req);
  });
});

// Route to handle incoming calls from Twilio - Clean version (No robotic voice)
server.route({
  method: ['GET', 'POST'],
  url: '/incoming',
  handler: async (request, reply) => {
    const streamUrl = `wss://${request.headers.host}/media-stream`;

    // Minimal TwiML for instant connection (Hyper-realistic)
    const twiml = `
    <Response>
      <Connect>
        <Stream url="${streamUrl}">
          <Parameter name="customerName" value="אורח" />
        </Stream>
      </Connect>
    </Response>
    `;

    reply.type('text/xml').send(twiml);
  }
});

server.get('/', async (request, reply) => {
  return { status: 'ok', service: 'Twilio-Gemini Voice Bridge' };
});

const start = async () => {
  try {
    await server.listen({ port: config.server.port, host: '0.0.0.0' });
    console.log(`Server listening on ${config.server.host}:${config.server.port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();

