import { groupCounters } from "../socketIndex.js";
import { updateGroupCounters } from "../utils/socket.helper.js";
import { GroupModel } from "../../../DB/models/group.model.js";
import {
  updateGroupActivity,
  markGroupForDeletion,
  trackUserActivity,
  updateUserLastActive,
  updateFlag,
} from "../socketIndex.js";

import { checkUserName } from "../utils/checkUsername.js";

export const handleJoinGroup = async (io, socket, data) => {
  try {
    const { groupId } = data;
    const roomName = `group-${groupId}`;

    // Quick deduplication key
    const dedupeKey = `join:${groupId}`;

    // If this socket is already processing this join
    if (socket.data?.processing?.[dedupeKey]) {
      console.log(
        `[DUPLICATE JOIN BLOCKED] socket ${socket.id} group ${groupId}`
      );
      socket.emit("group-joined", {
        success: true,
        groupId,
        message: "Join already in progress",
      });
      return;
    }

    // Mark as processing
    socket.data = socket.data || {};
    socket.data.processing = socket.data.processing || {};
    socket.data.processing[dedupeKey] = true;

    // Your original check (keep it, but it's not enough alone)
    if (socket.rooms.has(roomName)) {
      socket.emit("join-group-error", {
        success: false,
        message: "you are already joined",
      });
      delete socket.data.processing[dedupeKey]; // cleanup
      return;
    }

    console.log(`//////////////////////${socket.id}`);

    const group = await GroupModel.findById(groupId);
    if (!group) {
      socket.emit("join-group-error", {
        success: false,
        message: "Group not found",
      });
      return;
    }

    socket.join(`group-${groupId}`);

    updateGroupActivity(groupId);

    const userRole = group.getUserRole(socket.user._id);

    trackUserActivity(socket.id, socket.user._id, groupId, userRole, true);

    ////////////////
    await updateGroupCounters(groupId, userRole, "join", null);
    console.log("update counter for user " + socket.user._id);
    io.emit("group-counters-updated", {
      groupId: group._id,
      activeUsers: groupCounters.get(groupId).active || 0,
      guests: groupCounters.get(groupId).guests || 0,
      indatabase: groupCounters.get(groupId)?.indatabase || 0,
    });
    /////////////////////

    socket.emit("group-joined", {
      success: true,
      groupId,
      groupName: group.name,
      userRole,
      activeUsersCount: group.activeUsers.length,
      canSendMessages: userRole === "admin" || userRole === "active",
    });

    socket.to(`group-${groupId}`).emit("user-joined-group", {
      userId: socket.user._id,
      username: socket.user.username,
      userRole,
      timestamp: new Date(),
    });

    console.log(
      `User ${socket.user.username} successfully joined group ${groupId} as ${userRole}`
    );
  } catch (error) {
    console.error("Error joining group:", error);
    socket.emit("join-group-error", {
      success: false,
      message: "Failed to join group",
      error: error.message,
    });
  }
};

export const handleLeaveGroup = async (io, socket, data) => {
  try {
    const { groupId } = data;

    const roomName = `group-${groupId}`;

    if (!socket.rooms.has(roomName)) {
      socket.emit("leave-group-error", {
        success: false,
        message: "you are already leaved",
      });
      return;
    }

    const group = await GroupModel.findById(groupId);
    if (!group) {
      socket.emit("leave-group-error", {
        success: false,
        message: "Group not found",
      });
      return;
    }

    socket.leave(`group-${groupId}`);

    socket.to(`group-${groupId}`).emit("user-leaved-group", {
      userId: socket.user._id,
      username: socket.user.username,
      timestamp: new Date(),
    });

    const userRole = group.getUserRole(socket.user._id);
    updateFlag(socket.user._id);
    ////////////////
    await updateGroupCounters(groupId, userRole, "leave", null);
    io.emit("group-counters-updated", {
      groupId: group._id,
      activeUsers: groupCounters.get(groupId).active || 0,
      guests: groupCounters.get(groupId).guests || 0,
      indatabase: groupCounters.get(groupId)?.indatabase || 0,
    });
    /////////////////////

    console.log(`User ${socket.user.username} left group ${groupId}`);

    const room = io.sockets.adapter.rooms.get(`group-${groupId}`);
    if (!room || room.size === 0) {
      markGroupForDeletion(groupId);
      console.log(`Group ${groupId} marked for deletion (last user left)`);
    }

    socket.emit("group-left", {
      success: true,
      groupId,
    });
  } catch (error) {
    console.error("Error leaving group:", error);
    socket.emit("leave-group-error", {
      success: false,
      message: "Failed to leave group",
      error: error.message,
    });
  }
};

export const handleTyping = (io, socket, data) => {
  try {
    const { groupId, isTyping } = data;

    updateUserLastActive(socket.user._id, groupId);

    socket.to(`group-${groupId}`).emit("user-typing", {
      userId: socket.user._id,
      username: socket.user.username,
      isTyping,
      groupId,
    });
  } catch (error) {
    console.error("Error in handle typing :", error);
    socket.emit("typing-error", {
      success: false,
      message: "typing error",
      error: error.message,
    });
  }
};
