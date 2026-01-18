import { groupCounters } from "../socketIndex.js";
import { GroupModel } from "../../../DB/models/group.model.js";
export const updateGroupCounters = async (groupId, role, action, indatabasevar) => {
  try {
    groupId = groupId.toString();

    if (!groupCounters.has(groupId)) {
      const group = await GroupModel.findById(groupId);
      if (!group) return;

      groupCounters.set(groupId, {
        active: 0,
        guests: 0,
        indatabase: group.activeUsers.length,
      });
    }

    const counters = groupCounters.get(groupId);
    const isActive = role === "admin" || role === "active";

    if (action === "join") {
      isActive ? counters.active++ : counters.guests++;
    }

    if (action === "leave") {
      isActive ? counters.active-- : counters.guests--;
    }

    if (action === "indatabase" && indatabasevar !== undefined) {
      counters.indatabase = indatabasevar;
    }
  } catch (error) {
    console.error("updateGroupCounters error:", error);
  }
};
