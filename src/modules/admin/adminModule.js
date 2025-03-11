const ADMIN_CREDENTIALS = {
    login: 'admin',
    password: 'admin'
};

class AdminModule {
    constructor(io) {
        this.io = io;
        this.adminLogs = [];
        this.adminNames = [
            'Михаил', 'Александр', 'Николай', 'Владимир', 'Сергей', 'Андрей', 'Дмитрий', 'Иван',
            'Петр', 'Василий', 'Григорий', 'Алексей', 'Федор', 'Борис', 'Константин', 'Георгий'
        ];
    }

    getRandomAdminName() {
        return this.adminNames[Math.floor(Math.random() * this.adminNames.length)];
    }

    validateCredentials(login, password) {
        return login === ADMIN_CREDENTIALS.login && password === ADMIN_CREDENTIALS.password;
    }

    addLog(message, type = 'info') {
        const log = {
            message,
            type,
            timestamp: new Date().toLocaleTimeString()
        };
        this.adminLogs.push(log);
        
        const adminSockets = Array.from(this.io.sockets.sockets.values())
            .filter(socket => socket.isAdmin);
        adminSockets.forEach(socket => {
            socket.emit('adminLog', log);
        });
    }

    getLogs() {
        return this.adminLogs;
    }

    getAdminSockets() {
        return Array.from(this.io.sockets.sockets.values())
            .filter(socket => socket.isAdmin);
    }
}

module.exports = AdminModule; 