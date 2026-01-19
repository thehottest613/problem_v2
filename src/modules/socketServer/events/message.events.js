import { handleSendGroupMessage , handleDeleteGroupMessage} from "../handlers/message.handler.js";

export const setupMessageEvents = (io, socket) => {
  try {
    socket.on("send-group-message", async (data) => {
      await handleSendGroupMessage(io, socket, data);
    });

    socket.on("delete-group-message", async (data) => {
      await handleDeleteGroupMessage(io, socket, data);
    });
  } catch (error) {
    console.error("Error setting up message events:", error);
  }
};
