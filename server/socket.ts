import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { verifyToken, resolveTenantAccess } from './auth.ts';
import type { AuthUser, RoleType } from './auth.ts';

export interface PresenceEntry {
  userId: string;
  name: string;
  email: string;
  role: RoleType;
  tabCount: number;
  connectedAt: string;
}

let ioInstance: SocketIOServer | null = null;

// tenantId -> userId -> { meta, sockets: Set<socketId> }
const tenantPresence = new Map<
  string,
  Map<string, { user: AuthUser; role: RoleType; connectedAt: string; sockets: Set<string> }>
>();

function buildPresenceList(tenantId: string): PresenceEntry[] {
  const usersMap = tenantPresence.get(tenantId);
  if (!usersMap) return [];
  const result: PresenceEntry[] = [];
  for (const [, entry] of usersMap.entries()) {
    if (entry.sockets.size > 0) {
      result.push({
        userId: entry.user.id,
        name: entry.user.name,
        email: entry.user.email,
        role: entry.role,
        tabCount: entry.sockets.size,
        connectedAt: entry.connectedAt,
      });
    }
  }
  return result;
}

function removeSocketFromAllTenants(socketId: string): string[] {
  const affectedTenants: string[] = [];
  for (const [tenantId, usersMap] of tenantPresence.entries()) {
    for (const [userId, entry] of usersMap.entries()) {
      if (entry.sockets.delete(socketId)) {
        affectedTenants.push(tenantId);
        if (entry.sockets.size === 0) {
          usersMap.delete(userId);
        }
      }
    }
    if (usersMap.size === 0) {
      tenantPresence.delete(tenantId);
    }
  }
  return affectedTenants;
}

export function initializeSocketServer(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  io.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ||
      (socket.handshake.headers.authorization?.replace('Bearer ', '') as string | undefined);

    if (!token) {
      next(new Error('Authentication required for WebSocket connection.'));
      return;
    }

    const user = verifyToken(token);
    if (!user) {
      next(new Error('Invalid or expired JWT token.'));
      return;
    }

    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as AuthUser;

    socket.on(
      'tenant:join',
      (
        payload: { tenantId?: string },
        ack?: (res: { ok: boolean; error?: string; room?: string; presence?: PresenceEntry[] }) => void
      ) => {
        const requestedTenantId = payload?.tenantId;
        if (!requestedTenantId) {
          const err = { ok: false, error: 'tenantId is required.' };
          if (ack) ack(err);
          socket.emit('tenant:error', err);
          return;
        }

        // Strict server-side SQL authorization check
        const access = resolveTenantAccess(user.id, requestedTenantId);
        if (!access) {
          const err = {
            ok: false,
            error: `403 Forbidden: User ${user.email} is not authorized to join room tenant:${requestedTenantId}.`,
          };
          if (ack) ack(err);
          socket.emit('tenant:error', err);
          return;
        }

        // Leave any previous tenant rooms on this socket before switching
        for (const room of socket.rooms) {
          if (room.startsWith('tenant:') && room !== `tenant:${requestedTenantId}`) {
            socket.leave(room);
          }
        }
        const prevAffected = removeSocketFromAllTenants(socket.id);
        for (const prevTenantId of prevAffected) {
          if (prevTenantId !== requestedTenantId) {
            io.to(`tenant:${prevTenantId}`).emit('presence:update', {
              tenantId: prevTenantId,
              onlineUsers: buildPresenceList(prevTenantId),
            });
          }
        }

        const roomName = `tenant:${requestedTenantId}`;
        socket.join(roomName);

        let usersMap = tenantPresence.get(requestedTenantId);
        if (!usersMap) {
          usersMap = new Map();
          tenantPresence.set(requestedTenantId, usersMap);
        }

        let userEntry = usersMap.get(user.id);
        const isFirstTab = !userEntry || userEntry.sockets.size === 0;
        if (!userEntry) {
          userEntry = {
            user,
            role: access.role,
            connectedAt: new Date().toISOString(),
            sockets: new Set([socket.id]),
          };
          usersMap.set(user.id, userEntry);
        } else {
          userEntry.role = access.role;
          userEntry.sockets.add(socket.id);
        }

        const currentPresence = buildPresenceList(requestedTenantId);

        if (isFirstTab) {
          io.to(roomName).emit('presence:online', {
            tenantId: requestedTenantId,
            user: { userId: user.id, name: user.name, email: user.email, role: access.role },
          });
        }

        io.to(roomName).emit('presence:update', {
          tenantId: requestedTenantId,
          onlineUsers: currentPresence,
        });

        if (ack) {
          ack({
            ok: true,
            room: roomName,
            presence: currentPresence,
          });
        }
      }
    );

    socket.on('disconnect', () => {
      const affected = removeSocketFromAllTenants(socket.id);
      for (const tenantId of affected) {
        const usersMap = tenantPresence.get(tenantId);
        const stillOnline = usersMap?.has(user.id);
        if (!stillOnline) {
          io.to(`tenant:${tenantId}`).emit('presence:offline', {
            tenantId,
            userId: user.id,
          });
        }
        io.to(`tenant:${tenantId}`).emit('presence:update', {
          tenantId,
          onlineUsers: buildPresenceList(tenantId),
        });
      }
    });
  });

  ioInstance = io;
  return io;
}

export function emitToTenant(tenantId: string, event: string, payload: unknown): void {
  if (!ioInstance) return;
  ioInstance.to(`tenant:${tenantId}`).emit(event, payload);
}

export function getTenantOnlinePresence(tenantId: string): PresenceEntry[] {
  return buildPresenceList(tenantId);
}
