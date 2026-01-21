import {
  connectedUsers,
  userGroupActivity,
  getIO,
  markGroupForDeletion,
  updateOnlineFlag,
} from "../socketIndex.js";

import { groupCounters } from "../socketIndex.js";
import { updateGroupCounters } from "../utils/socket.helper.js";
import { GroupModel } from "../../../DB/models/group.model.js";

export const handleDisconnection = async (socket, reason) => {
  try {
    const userId = socket.user?._id?.toString();
    if (!userId) return;
    const storedSocketId = connectedUsers.get(userId);
    if (storedSocketId === socket.id) {
      connectedUsers.delete(userId);
    }

    console.log(
      `User disconnected: ${socket.user?.username} (${socket.id}) - Reason: ${reason}`,
    );

    const io = getIO();

    await checkAndUpdateGroupActivity(socket, io, socket.user._id);

  } catch (error) {
    console.error("Error handle disconnection:", error);
  }
};

const checkAndUpdateGroupActivity = async (socket, io, userId) => {
  try {
    const userIdStr = userId.toString();

    const groups = userGroupActivity.get(userIdStr);
    if (!groups || groups.size === 0) {
      return;
    }

    let lastGroupId = null;
    let lastActivity = null;

    for (const [groupId, activity] of groups.entries()) {
      if (activity.flag === true) {
        lastGroupId = groupId;
        lastActivity = activity;
        break;
      }
    }

    if (!lastGroupId) {
      console.log(
        `No last active group found for disconnecting user ${userId}`,
      );
      return;
    }

    console.log(
      `Disconnecting user ${socket.user?.username} from last group: ${lastGroupId}`,
    );

    const group = await GroupModel.findById(lastGroupId);
    if (!group) {
      console.log(`Group ${lastGroupId} not found during disconnect cleanup`);
      return;
    }

    const userRole = group.getUserRole(userId);

    await updateGroupCounters(lastGroupId, userIdStr, userRole, "leave", null);

    const counters = groupCounters.get(lastGroupId);

    io.emit("group-counters-updated", {
      groupId: lastGroupId,
      activeUsers: counters?.actives?.size || 0,
      guests: counters?.guests?.size || 0,
      indatabase: counters?.indatabase || 0,
    });

    updateOnlineFlag(userIdStr, lastGroupId);

    const room = io.sockets.adapter.rooms.get(`group-${lastGroupId}`);
    if (!room || room.size === 0) {
      markGroupForDeletion(lastGroupId);
      console.log(
        `Group ${lastGroupId} marked for deletion (last user disconnected)`,
      );
    }
  } catch (error) {
    console.error("Error checking group activity on disconnect:", error);
  }
};
