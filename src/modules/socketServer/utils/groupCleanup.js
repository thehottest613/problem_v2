import { GroupModel } from "../../../DB/models/group.model.js";
import { groupLastActivity, userGroupActivity } from "../socketIndex.js";
import { groupCounters } from "../socketIndex.js";
import { updateGroupCounters } from "../utils/socket.helper.js";
import { removeUserActivity, markGroupForDeletion } from "../socketIndex.js"; // FIX: Added import for removeUserActivity

let cleanupIo = null;

const deleteInactiveGroups = async () => {
  if (!cleanupIo) {
    console.error("Cleanup: io instance not available");
    return;
  }

  try {
    const now = new Date();
    const groupsToDelete = [];

    for (const [groupId, activity] of groupLastActivity.entries()) {
      if (now >= activity.deletionScheduled) {
        groupsToDelete.push(groupId);
      }
    }

    for (const groupId of groupsToDelete) {
      try {
        const group = await GroupModel.findById(groupId);
        if (!group) {
          groupLastActivity.delete(groupId);
          continue;
        }

        await GroupModel.findByIdAndDelete(groupId);
        console.log(`Cleanup: Deleted inactive group: ${groupId}`);

        cleanupIo.emit("group-deleted", {
          success: true,
          groupId,
          message: "Group has been deleted due to inactivity",
        });

        groupLastActivity.delete(groupId);
      } catch (error) {
        console.error(`Cleanup: Error deleting group ${groupId}:`, error);
      }
    }
  } catch (error) {
    console.error("Cleanup: Error in deleteInactiveGroups:", error);
  }
};

const kickInactiveUsers = async () => {
  if (!cleanupIo) {
    console.error("Cleanup: io instance not available");
    return;
  }

  try {
    const now = new Date();
    const THIRTY_MINUTES = 20 * 60 * 1000;
    const usersToKick = [];

    // Step 1: Collect candidates and clean guests/admins
    for (const [userIdStr, groupSessions] of userGroupActivity.entries()) {
      for (const [groupId, activity] of [...groupSessions.entries()]) {
        // copy to avoid mutation issues during iteration

        const group = await GroupModel.findById(groupId);
        if (!group) {
          removeUserActivity(userIdStr, groupId);
          continue;
        }

        const userRole = group.getUserRole(activity.userId);

        if (userRole === "guest") {
          if (activity.flag === false) {
            console.log(
              `Cleanup: Removing stale guest activity for user ${activity.userId} in group ${groupId}`
            );
            removeUserActivity(userIdStr, groupId);
          }
          continue;
        }

        if (userRole === "admin") {
          if (activity.flag === true) {
            activity.lastMessageSent = new Date();
            activity.lastActive = new Date();
            console.log(
              `Admin ${activity.userId} activity refreshed in group ${groupId}`
            );
          } else {
            removeUserActivity(userIdStr, groupId);
          }
          continue;
        }

        if (userRole === "active") {
          const timeSinceLastMessage = now - new Date(activity.lastMessageSent);

          if (timeSinceLastMessage >= THIRTY_MINUTES) {
            const lastSocketId = activity.lastSocketId;
            const socket = lastSocketId
              ? cleanupIo.sockets.sockets.get(lastSocketId)
              : null;
            const isOnline = !!socket && socket.connected;

            usersToKick.push({
              userId: userIdStr,
              groupId,
              isOnline,
              socket: socket,
              flag: activity.flag,
              onlineFlag: activity.onlineFlag,
            });
          }
        }
      }
    }

    for (const user of usersToKick) {
      try {
        const group = await GroupModel.findById(user.groupId);
        if (!group) {
          removeUserActivity(user.userId, user.groupId);
          continue;
        }

        const userRole = group.getUserRole(user.userId);
        if (userRole !== "active") continue;

        await group.removeUser(user.userId);
        await group.save();

        console.log(
          `Cleanup: Removed inactive active user ${user.userId} from group ${user.groupId}`
        );

        if (user.flag === true && user.onlineFlag === true) {
          await updateGroupCounters(user.groupId, "active", "leave", null);
          await updateGroupCounters(user.groupId, "guest", "join", null);
        }
        await updateGroupCounters(
            user.groupId,
            userRole,
            "indatabase",
            group.activeUsers.length
          );
          cleanupIo.emit("group-counters-updated", {
            groupId: group._id,
            activeUsers: groupCounters.get(user.groupId)?.active || 0,
            guests: groupCounters.get(user.groupId)?.guests || 0,
            indatabase: groupCounters.get(user.groupId)?.indatabase || 0,
          });

        // Notify
        const eventPayload = {
          userId: user.userId,
          groupId: user.groupId,
          reason: "inactivity",
          removedFromActiveUsers: true,
          timestamp: new Date(),
          activeUsersCount: group.activeUsers.length,
        };

        if (user.isOnline && user.socket) {
          // Online user - direct emit
          user.socket.emit("user-kicked", {
            success: false,
            groupId: user.groupId,
            message: "you have been kicked as a active user",
            reason: "inactivity",
            removedFromActiveUsers: true,
          });

          user.socket.leave(`group-${user.groupId}`);

          user.socket.to(`group-${user.groupId}`).emit("user-removed", {
            ...eventPayload,
            username: user.socket.user?.username || "Unknown",
          });

          console.log(
            `Kicked online inactive user ${user.userId} from ${user.groupId}`
          );
        } else {
          // Offline user - broadcast to room
          cleanupIo.to(`group-${user.groupId}`).emit("user-removed", {
            ...eventPayload,
            username: "Offline User",
          });

          console.log(
            `Removed offline inactive user ${user.userId} from ${user.groupId}`
          );
        }

        // Clean up activity (now using userId)
        removeUserActivity(user.userId, user.groupId);

        // Step 3: Check if group is now empty
        const room = cleanupIo.sockets.adapter.rooms.get(
          `group-${user.groupId}`
        );
        if (!room || room.size === 0) {
          markGroupForDeletion(user.groupId);
          console.log(
            `Group ${user.groupId} marked for deletion after kick (empty)`
          );
        }
      } catch (error) {
        console.error(`Cleanup error kicking user ${user.userId}:`, error);
      }
    }
  } catch (error) {
    console.error("Cleanup: Error in kickInactiveUsers:", error);
  }
};

export const startCleanupIntervals = (ioInstance) => {
  cleanupIo = ioInstance;

  if (!cleanupIo) {
    console.error("Cannot start cleanup intervals: io instance is null");
    return;
  }

  setInterval(() => {
    console.log("Cleanup: Running deleteInactiveGroups check...");
    deleteInactiveGroups();
  }, 2 * 60 * 1000);

  setInterval(() => {
    console.log("Cleanup: Running kickInactiveUsers check...");
    kickInactiveUsers();
  }, 5 * 60 * 1000);

  console.log("Cleanup: Group cleanup intervals started");
};
