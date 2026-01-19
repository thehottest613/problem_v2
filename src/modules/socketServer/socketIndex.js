// socketServer/index.js
// (No changes needed here)
import { Server } from "socket.io";
import { authMiddleware } from "./middlewares/authSocket.middleware.js";
import { setupConnectionEvents } from "./events/connection.events.js";
import { setupGroupEvents } from "./events/group.events.js";
import { setupMessageEvents } from "./events/message.events.js";
import { startCleanupIntervals } from "./utils/groupCleanup.js";
let io;
export const connectedUsers = new Map();
export const groupCounters = new Map();
export const groupLastActivity = new Map(); // groupId -> { lastUserLeft: Date }
export const userGroupActivity = new Map(); // socketId -> { userId, groupId, lastActive: Date }
export const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: "*",
      credentials: false,
    },
    connectionStateRecovery: {
      maxDisconnectionDuration: 60 * 1000,
    },
  });
  io.use(authMiddleware);
  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.user.username||"null"} (${socket.id})`);
    setupConnectionEvents(io, socket);
    setupGroupEvents(io, socket);
    setupMessageEvents(io, socket);
  });
  // Pass the io instance to cleanup
  startCleanupIntervals(io);
  return io;
};
export const getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized");
  }
  return io;
};
export const getUserSockets = (userId) => {
  const sockets = connectedUsers.get(userId);
  return sockets ? Array.from(sockets) : [];
};
export const updateGroupActivity = (groupId) => {
  groupLastActivity.delete(groupId);
};
export const markGroupForDeletion = (groupId) => {
  groupLastActivity.set(groupId, {
    lastUserLeft: new Date(),
    deletionScheduled: new Date(Date.now() + 5 * 60 * 1000),
  });
};
export const trackUserActivity = (
  socketId,           
  userId,            
  groupId,
  userRole,
  flag = true
) => {
  const userIdStr = userId.toString();

  if (!userGroupActivity.has(userIdStr)) {
    userGroupActivity.set(userIdStr, new Map());
  }

  const groups = userGroupActivity.get(userIdStr);


  if (groups.has(groupId)) {
    const activity = groups.get(groupId);
    activity.userRole = userRole;
    activity.lastActive = new Date();
    activity.flag = flag;
    activity.lastSocketId = socketId;
  } else {
    groups.set(groupId, {
      userId: userIdStr,
      groupId,
      userRole,
      lastActive: new Date(),
      lastMessageSent: new Date(), // fresh on join
      flag,
      lastSocketId: socketId, // optional
    });
  }
};

export const updateFlag = (userId) => {
  const userIdStr = userId.toString();
  
  if (!userGroupActivity.has(userIdStr)) {
    return;
  }

  const groups = userGroupActivity.get(userIdStr);

  for (const activity of groups.values()) {
    activity.flag = false;
  }
};
export const updateUserLastActive = (userId, groupId) => {
  const userIdStr = userId.toString();
  const groupIdStr = groupId.toString();

  const groups = userGroupActivity.get(userIdStr);
  if (!groups) return;

  const activity = groups.get(groupIdStr);
  if (!activity) return;

  activity.lastActive = new Date();
};
export const updateUserLastMessage = (userId, groupId) => {
  const userIdStr = userId.toString();
  const groupIdStr = groupId.toString();

  const groups = userGroupActivity.get(userIdStr);
  if (!groups) return;

  const activity = groups.get(groupIdStr);
  if (!activity) return;

  const now = new Date();
  activity.lastMessageSent = now;
  activity.lastActive = now;
  // Optional: update socketId if you want
};
export const removeUserActivity = (userId, groupId) => {
  const userIdStr = String(userId);    // safe conversion (ObjectId, string, etc.)
  const groupIdStr = String(groupId);

  const userGroups = userGroupActivity.get(userIdStr);
  if (!userGroups) {
    return;
  }

  userGroups.delete(groupIdStr);

  // Clean up the user entry if they have no more active groups
  if (userGroups.size === 0) {
    userGroupActivity.delete(userIdStr);
  }
};
