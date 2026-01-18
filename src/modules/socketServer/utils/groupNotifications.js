import admin from "firebase-admin";
import Usermodel from "../../../DB/models/User.model.js";

export const sendGroupMessageNotifications = async (
  group,
  savedMessage,
  sender,
  type,
  content
) => {
  try {
    const allMembers = new Set();
    group.activeUsers.forEach((user) => {
      allMembers.add(user.user.toString());
    });
    allMembers.add(group.admin.toString());

    allMembers.delete(sender._id.toString());

    const memberIds = Array.from(allMembers);

    const users = await Usermodel.find(
      { _id: { $in: memberIds } },
      { _id: 1, fcmToken: 1 }
    );

    const notificationTitle = `New message in ${group.name}`;
    const notificationBody = `${sender.username}: ${
      content || (type === "image" ? "sent an image" : "sent a voice message")
    }`;

    for (const user of users) {
      if (user.fcmToken) {
        try {
          await admin.messaging().send({
            notification: {
              title: notificationTitle,
              body: notificationBody,
            },
            data: {
              groupId: group._id.toString(),
              messageId: savedMessage._id.toString(),
              type: "group_message",
            },
            token: user.fcmToken,
          });
          console.log(
            `Push notification sent to user ${user._id} for group message`
          );
        } catch (fcmError) {
          console.error("Failed to send push notification:", fcmError.message);
          if (
            fcmError.message.includes("Requested entity was not found") ||
            fcmError.message.includes(
              "The registration token is not a valid FCM registration token"
            )
          ) {
            console.log(
              `Invalid FCM token detected, removing from user ${user._id}`
            );
            await Usermodel.findByIdAndUpdate(user._id, {
              $set: { fcmToken: null },
            });
          }
        }
      }
    }
  } catch (error) {
    console.error("Error sending group message notifications:", error);
  }
};
