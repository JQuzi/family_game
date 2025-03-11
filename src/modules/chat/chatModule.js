const chatHistory = {};

class ChatModule {
    constructor(io) {
        this.io = io;
    }

    initializeTableChat(tableId) {
        if (!chatHistory[tableId]) {
            chatHistory[tableId] = [];
        }
    }

    handleMessage(socket, tableId, player, message) {
        if (!tableId) return;

        if (!chatHistory[tableId]) {
            this.initializeTableChat(tableId);
        }

        const chatMessage = {
            sender: player?.name || 'Система',
            role: player?.role || 'system',
            message: message,
            timestamp: new Date().toLocaleTimeString(),
            isSystem: !player || player.role === 'system'
        };
        
        chatHistory[tableId].push(chatMessage);
        this.io.to(tableId).emit('chatMessage', chatMessage);
    }

    getTableHistory(tableId) {
        return chatHistory[tableId] || [];
    }

    clearTableHistory(tableId) {
        chatHistory[tableId] = [];
    }
}

module.exports = ChatModule; 