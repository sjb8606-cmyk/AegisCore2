import { Server } from 'socket.io';
import { getLogger } from '../../observability/src/index';

const logger = getLogger('collaboration:ws');

export function initWebSocket(server: any) {
  const io = new Server(server, { cors: { origin: "*" } });

  io.on('connection', (socket) => {
    // The "Handshake" — Tenant Isolation
    const tenantId = socket.handshake.query.tenantId;
    
    socket.on('join', (room) => {
      // SECURITY: Force room names to be tenant-prefixed
      const secureRoom = `${tenantId}:${room}`;
      socket.join(secureRoom);
      logger.info({ tenantId, secureRoom }, 'User joined room');
    });

    socket.on('message', (data) => {
      io.to(`${tenantId}:${data.room}`).emit('message', data.content);
    });
  });
}
