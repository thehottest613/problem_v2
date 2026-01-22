import { asyncHandelr } from "../../../utlis/response/error.response.js";
import { GroupModel } from "../../../DB/models/group.model.js";
import { getIO } from "../../socketServer/socketIndex.js";
import { groupCounters } from "../../socketServer/socketIndex.js";
import { checkUserName } from "../../socketServer/utils/checkUsername.js";
import { updateGroupCounters } from "../../socketServer/utils/socket.helper.js";

export const joinAsActive = asyncHandelr(async (req, res, next) => {
  const userId = req.user._id;
  const { groupId } = req.body;

  try {
    if (!checkUserName(req.user)) throw new Error("user expired");
    const group = await checkCanJoinAsActive(groupId, userId);
    await group.addActiveUser(userId);
    const userRole = group.getUserRole(userId);
    await updateGroupCounters(
      groupId,
      userId,
      userRole,
      "indatabase",
      group.activeUsers.length,
    );
    await updateGroupCounters(groupId, userId, userRole, "join", null);
    const io = getIO();
    const counters = groupCounters.get(groupId);

    io.emit("group-counters-updated", {
      groupId: groupId,
      activeUsers: counters?.actives?.size || 0,
      guests: counters?.guests?.size || 0,
      indatabase: counters?.indatabase || 0,
    });
    io.to(`group-${groupId}`).emit("user-become-active", {
      userId: userId.toString(),
      username: req.user.username || "Unknown",
      groupId: groupId.toString(),
      timestamp: new Date(),
    });

    res.status(200).json({
      success: true,
      message: "Successfully joined as active member",
      data: {
        groupId,
        groupName: group.name,
        activeUsersCount: group.activeUsers.length,
        joinedAt: new Date(),
      },
    });
  } catch (error) {
    return next(new Error(error.message, 400));
  }
});

export const leaveActiveGroup = asyncHandelr(async (req, res, next) => {
  const userId = req.user._id;
  const { groupId } = req.body;

  const group = await GroupModel.findById(groupId);
  if (!group) {
    return next(new Error("Group not found", { cause: 404 }));
  }

  const userRole = group.getUserRole(userId);
  if (userRole !== "active" && userRole !== "admin") {
    return next(
      new Error("You are not an active member of this group", { cause: 403 }),
    );
  }

  if (userRole === "admin") {
    return next(new Error("You are admin you cant left group", { cause: 403 }));
  }

  await group.removeUser(userId);
  await group.save();

  await updateGroupCounters(
    groupId,
    userId,
    userRole,
    "indatabase",
    group.activeUsers.length,
  );

  const io = getIO();
  const counters = groupCounters.get(groupId);

  io.emit("group-counters-updated", {
    groupId: groupId,
    activeUsers: counters?.actives?.size || 0,
    guests: counters?.guests?.size || 0,
    indatabase: counters?.indatabase || 0,
  });

  io.to(`group-${groupId}`).emit("user-left-group", {
    userId: userId.toString(),
    username: req.user.username || "Unknown",
    groupId: groupId.toString(),
    timestamp: new Date(),
  });

  res.status(200).json({
    success: true,
    message: "Successfully left active users in the group",
    data: group,
  });
});

export const createGroup = asyncHandelr(async (req, res, next) => {
  if (!checkUserName(req.user)) throw new Error("user expired");
  const userId = req.user._id;
  const { name, description, imageId } = req.body;

  const group = await GroupModel.create({
    name,
    description,
    admin: userId,
    activeUsers: [{ user: userId }],
    imageId,
  });

  await group.populate("imageId");

  const io = getIO();
  io.emit("group-created", {
    success: true,
    group: {
      _id: group._id,
      name: group.name,
      description: group.description,
      admin: group.admin,
      activeUsersCount: group.activeUsers.length,
      image: group.imageId?.image.secure_url || undefined,
      createdAt: group.createdAt,
    },
    activeUsers: 1,
    guests: 0,
    message: "New group created",
  });

  res.status(201).json({
    success: true,
    message: "Group created successfully",
    data: group,
  });
});

export const getUserGroups = asyncHandelr(async (req, res, next) => {
  const userId = req.user._id;
  const allGroups = await GroupModel.find({ isActive: true })
    .select("-messages")
    .populate("imageId");
  const sortedGroups = allGroups.sort((a, b) => {
    const aIsAdmin = a.admin.toString() === userId.toString();
    const bIsAdmin = b.admin.toString() === userId.toString();
    if (aIsAdmin && !bIsAdmin) return -1;
    if (!aIsAdmin && bIsAdmin) return 1;
    const aIsMember = a.isMember(userId);
    const bIsMember = b.isMember(userId);
    if (aIsMember && !bIsMember) return -1;
    if (!aIsMember && bIsMember) return 1;
    return 0;
  });
  const formattedGroups = sortedGroups.map((group) => {
    const counters = groupCounters.get(group._id.toString());
    return {
      ...group.toObject(),
      userRole: group.getUserRole(userId),
      isMember: group.isMember(userId),
      counter: {
        active: counters?.actives?.size || 0,
        guests: counters?.guests?.size || 0,
      },
    };
  });
  res.status(200).json({
    success: true,
    data: formattedGroups,
  });
});

export const getGroupMessages = asyncHandelr(async (req, res, next) => {
  const { groupId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;

  const group = await GroupModel.findById(groupId)
    .populate({
      path: "messages.sender",
      select: "username email ImageId",
      populate: {
        path: "ImageId",
        select: "image", // Select the 'image' object which contains secure_url
      },
    })
    .populate({
      path: "admin",
      select: "username email ImageId",
      populate: {
        path: "ImageId",
        select: "image",
      },
    })
    .populate({
      path: "activeUsers.user",
      select: "username email ImageId",
      populate: {
        path: "ImageId",
        select: "image",
      },
    });

  if (!group) {
    return next(new Error("Group not found", { cause: 404 }));
  }

  const totalMessages = group.messages.length;
  const totalPages = Math.ceil(totalMessages / limit);
  const skip = (page - 1) * limit;

  const sortedMessages = [...group.messages].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );

  const paginatedMessages = sortedMessages.slice(skip, skip + limit);

  res.status(200).json({
    success: true,
    message: "Group messages retrieved successfully",
    data: {
      groupId: group._id,
      groupName: group.name,
      admin: group.admin
        ? {
            _id: group.admin._id,
            username: group.admin.username,
            email: group.admin.email,
            image: group.admin.ImageId?.image?.secure_url || null, // Access secure_url
          }
        : null,
      activeUsers: group.activeUsers.map((au) => ({
        user: au.user
          ? {
              _id: au.user._id,
              username: au.user.username,
              email: au.user.email,
              image: au.user.ImageId?.image?.secure_url || null, // Access secure_url
            }
          : null,
        joinedAt: au.joinedAt,
      })),
      totalMessages,
      currentPage: page,
      totalPages,
      limit,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      messages: paginatedMessages.map((msg) => {
        // Handle deleted messages
        if (msg.isDeleted) {
          return {
            _id: msg._id,
            sender: msg.sender
              ? {
                  _id: msg.sender._id,
                  username: msg.sender.username,
                  email: msg.sender.email,
                  image: msg.sender.ImageId?.image?.secure_url || null, // Access secure_url
                }
              : null,
            type: "deleted",
            content: null,
            image: null,
            voice: null,
            isDeleted: true,
            deletedAt: msg.deletedAt || msg.updatedAt,
            createdAt: msg.createdAt,
            updatedAt: msg.updatedAt,
            replyTo: null,
          };
        }

        // Normal message
        return {
          _id: msg._id,
          sender: msg.sender
            ? {
                _id: msg.sender._id,
                username: msg.sender.username,
                email: msg.sender.email,
                image: msg.sender.ImageId?.image?.secure_url || null, // Access secure_url
              }
            : null,
          content: msg.content,
          type: msg.type,
          image: msg.image,
          voice: msg.voice,
          createdAt: msg.createdAt,
          updatedAt: msg.updatedAt,
          replyTo:
            msg.replyTo && msg.replyTo._id
              ? {
                  _id: msg.replyTo._id,
                  content: msg.replyTo.content ?? null,
                  type: msg.replyTo.type ?? null,
                  image: msg.replyTo.image?.url ? msg.replyTo.image : null,
                  voice: msg.replyTo.voice?.url ? msg.replyTo.voice : null,
                  createdAt: msg.replyTo.createdAt,
                }
              : null,
        };
      }),
    },
  });
});

// Optional: Get single message by ID
export const getMessageById = asyncHandelr(async (req, res, next) => {
  if (!checkUserName(req.user))
    throw new Error("You have to change your nick name");
  const userId = req.user._id;
  const { groupId, messageId } = req.params;

  const group = await GroupModel.findById(groupId);

  if (!group) {
    return next(new Error("Group not found", { cause: 404 }));
  }

  // Check if user is a member
  if (!group.isMember(userId)) {
    return next(
      new Error("You are not a member of this group", { cause: 403 }),
    );
  }

  // Find the message
  const message = group.messages.id(messageId);

  if (!message) {
    return next(new Error("Message not found", { cause: 404 }));
  }

  res.status(200).json({
    success: true,
    message: "Message retrieved successfully",
    data: {
      groupId: group._id,
      groupName: group.name,
      message: {
        _id: message._id,
        sender: message.sender,
        content: message.content,
        type: message.type,
        image: message.image,
        voice: message.voice,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
      },
    },
  });
});

export const checkCanJoinAsActive = async (groupId, userId) => {
  try {
    const group = await GroupModel.findById(groupId);
    if (!group) {
      throw new Error("Group not found");
    }

    if (group.isMember(userId)) {
      throw new Error("User is already a member");
    }

    if (!group.hasActiveSpace()) {
      throw new Error("Group is full. Maximum 5 active users allowed.");
    }

    return group;
  } catch (error) {
    throw new Error(error.message);
  }
};
