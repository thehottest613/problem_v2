import { groupCounters } from "../socketIndex.js";
import { GroupModel } from "../../../DB/models/group.model.js";
export const updateGroupCounters = async (
  groupId,
  userId,
  role,
  action,
  indatabasevar,
) => {
  try {
    groupId = groupId.toString();
    userId = userId.toString();

    if (!groupCounters.has(groupId)) {
      const group = await GroupModel.findById(groupId).select("activeUsers");
      if (!group) return;

      groupCounters.set(groupId, {
        actives: new Set(),
        guests: new Set(),
        indatabase: group.activeUsers.length,
      });
    }

    const counters = groupCounters.get(groupId);
    const isActive = role === "admin" || role === "active";

    if (action === "join" || action === "leave") {
      counters.actives.delete(userId);
      counters.guests.delete(userId);
    }

    if (action === "join") {
      if (isActive) {
        counters.actives.add(userId);
      } else {
        counters.guests.add(userId);
      }
    }

    if (action === "indatabase" && indatabasevar !== undefined) {
      counters.indatabase = indatabasevar;
    }
  } catch (error) {
    console.error("updateGroupCounters error:", error);
  }
};
