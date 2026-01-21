import { GroupModel } from "../../../DB/models/group.model.js";
import { updateUserLastMessage , connectedUsers} from "../socketIndex.js";
import { checkUserName } from "../utils/checkUsername.js";
import { sendGroupMessageNotifications } from "../utils/groupNotifications.js";

export const handleSendGroupMessage = async (io, socket, data) => {
  try {
    if (!checkUserName(socket.user)) {
      socket.emit("message-error", {
        success: false,
        message: "user expired",
      });
      return;
    }
    const { groupId, content, image, voice, type = "text", replyTo } = data;

    console.log(
      `====================> user ${socket.user._id} will send ${content}`,
    );

    console.log(
      `User ${socket.user.username} sending message to group ${groupId}`,
    );

    if (!groupId) {
      socket.emit("message-error", {
        success: false,
        message: "Group ID is required",
      });
      return;
    }

    const group = await GroupModel.findById(groupId);
    if (!group) {
      socket.emit("message-error", {
        success: false,
        message: "Group not found",
      });
      return;
    }

    const userRole = group.getUserRole(socket.user._id);
    if (userRole !== "admin" && userRole !== "active") {
      socket.emit("message-error", {
        success: false,
        message: "Only active members and admin can send messages",
      });
      return;
    }

    // Validate message content based on type
    if (type === "text" && !content) {
      socket.emit("message-error", {
        success: false,
        message: "Text message requires content",
      });
      return;
    }

    if (type === "image" && !image?.url) {
      socket.emit("message-error", {
        success: false,
        message: "Image message requires image URL",
      });
      return;
    }

    if (type === "voice" && !voice?.url) {
      socket.emit("message-error", {
        success: false,
        message: "Voice message requires voice URL",
      });
      return;
    }

    let replyToObject = undefined;

    if (replyTo) {
      const replyToMessage = group.messages.id(replyTo);

      if (!replyToMessage) {
        socket.emit("message-error", {
          success: false,
          message: "Reply target message not found",
        });
        return;
      }

      replyToObject = {
        _id: replyToMessage._id,
        sender: replyToMessage.sender,
        content: replyToMessage.content
          ? replyToMessage.content.substring(0, 100)
          : null,
        type: replyToMessage.type,
        image: replyToMessage.image,
        voice: replyToMessage.voice,
        createdAt: replyToMessage.createdAt,
      };
    }

    const message = {
      sender: socket.user._id,
      content,
      image,
      voice,
      type,
      replyTo: replyToObject,
    };

    group.messages.push(message);
    await group.save();

    const savedMessage = group.messages[group.messages.length - 1];

    await sendGroupMessageNotifications(
      group,
      savedMessage,
      socket.user,
      type,
      content,
    );

    const messageWithSender = {
      ...savedMessage.toObject(),
      sender: {
        _id: socket.user._id,
        username: socket.user.username,
        email: socket.user.email,
      },
    };

    updateUserLastMessage(socket.user._id, group._id);

    const populatedUser = await socket.user.populate("ImageId");

    io.to(`group-${groupId}`).emit("new-group-message", {
      success: true,
      message: messageWithSender,
      group: {
        _id: group._id,
        name: group.name,
        admin: group.admin,
      },
      fromUser: {
        _id: populatedUser._id,
        username: populatedUser.username,
        avatar: populatedUser.ImageId,
      },
    });

    const allMembers = new Set();

    group.activeUsers.forEach((user) => {
      allMembers.add(user.user.toString());
    });

    allMembers.add(group.admin.toString());

    allMembers.forEach((memberId) => {
      const groupUpdate = {
        _id: group._id,
        name: group.name,
        lastMessage: {
          content: content || (type === "image" ? "Image" : "Voice message"),
          type,
          senderId: socket.user._id,
          senderName: socket.user.username,
          timestamp: savedMessage.createdAt,
          replyTo: replyTo ? replyTo.toString() : undefined,
        },
        updatedAt: new Date(),
      };

      const socketId = connectedUsers.get(memberId.toString());

      if (socketId) {
        io.to(socketId).emit("group-updated", {
          success: true,
          group: groupUpdate,
          message: savedMessage,
        });
      }
    });
  } catch (error) {
    console.error("Error sending message:", error);
    socket.emit("message-error", {
      success: false,
      message: "Failed to send message",
      error: error.message,
    });
  }
};

export const handleDeleteGroupMessage = async (io, socket, data) => {
  try {
    const { groupId, messageId } = data;

    if (!groupId || !messageId) {
      socket.emit("delete-message-error", {
        success: false,
        message: "Group ID and Message ID are required",
      });
      return;
    }

    console.log(
      `User ${socket.user.username} attempting to delete message ${messageId} in group ${groupId}`,
    );

    const group = await GroupModel.findById(groupId);
    if (!group) {
      socket.emit("delete-message-error", {
        success: false,
        message: "Group not found",
      });
      return;
    }

    // Check permissions: only sender or admin can delete
    const userRole = group.getUserRole(socket.user._id);
    const message = group.messages.id(messageId);

    if (!message) {
      socket.emit("delete-message-error", {
        success: false,
        message: "Message not found",
      });
      return;
    }

    const isSender = message.sender.toString() === socket.user._id.toString();
    const isAdmin = userRole === "admin";

    if (!isSender && !isAdmin) {
      socket.emit("delete-message-error", {
        success: false,
        message: "You can only delete your own messages or you must be admin",
      });
      return;
    }

    // Soft delete (recommended for chat apps)
    message.isDeleted = true;
    message.content = null; // optional: clear content
    message.image = undefined;
    message.voice = undefined;

    await group.save();

    // Notify everyone in the group room
    io.to(`group-${groupId}`).emit("message-deleted", {
      success: true,
      groupId,
      messageId,
      deletedBy: socket.user._id,
      deletedByUsername: socket.user.username,
      timestamp: new Date(),
    });

    // Optional: update last message preview for all members (if this was the last message)
    const lastMessage = group.messages[group.messages.length - 1];
    if (lastMessage && lastMessage._id.toString() === messageId) {
      // Re-calculate last message preview (simple fallback)
      const fallbackContent = lastMessage.isDeleted
        ? "[Deleted message]"
        : "Message deleted";

      const allMembers = new Set();
      group.activeUsers.forEach((u) => allMembers.add(u.user.toString()));
      allMembers.add(group.admin.toString());

      allMembers.forEach((memberId) => {
        const socketId = connectedUsers.get(memberId.toString());
        if (socketId) {
          io.to(socketId).emit("group-updated", {
            success: true,
            group: {
              _id: group._id,
              name: group.name,
              lastMessage: {
                content: fallbackContent,
                type: "system",
                senderId: socket.user._id,
                senderName: "System",
                timestamp: new Date(),
              },
              updatedAt: new Date(),
            },
          });
        }
      });
    }

    console.log(
      `Message ${messageId} deleted in group ${groupId} by ${socket.user.username}`,
    );
  } catch (error) {
    console.error("Error deleting message:", error);
    socket.emit("delete-message-error", {
      success: false,
      message: "Failed to delete message",
      error: error.message,
    });
  }
};
