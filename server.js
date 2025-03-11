const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const ChatModule = require('./src/modules/chat/chatModule');
const AdminModule = require('./src/modules/admin/adminModule');
const ReferralModule = require('./src/modules/game/referralModule');
const TableModule = require('./src/modules/game/tableModule');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const chatModule = new ChatModule(io);
const adminModule = new AdminModule(io);
const referralModule = new ReferralModule();
const tableModule = new TableModule();

app.use(express.static('public')); // Раздаём файлы из папки public

// Статистика игры
let gameStats = {
    closedTables: 0,
    totalRegisteredPlayers: new Set(),
    activeGames: new Map()
};

io.on('connection', (socket) => {
    console.log(`Игрок ${socket.id} подключился`);

    // Обработчик сообщений чата
    socket.on('chatMessage', (message) => {
        const player = tableModule.findPlayerBySocketId(socket.id);
        const table = tableModule.findTableByPlayerId(socket.id);
        
        if (player && table) {
            chatModule.handleMessage(socket, table.id, player, message);
        }
    });

    // Обработчик входа админа
    socket.on('adminLogin', (data) => {
        if (adminModule.validateCredentials(data.login, data.password)) {
            socket.isAdmin = true;
            socket.emit('adminLoginResponse', { 
                success: true,
                stats: tableModule.getGameStats(),
                logs: adminModule.getLogs()
            });
            
            socket.emit('adminTablesUpdate', tableModule.getTablesInfo());
        } else {
            socket.emit('adminLoginResponse', { 
                success: false, 
                message: 'Неверный логин или пароль' 
            });
        }
    });

    // Обновленный обработчик создания первого стола
    socket.on('createFirstTable', () => {
        if (!socket.isAdmin) return;
        
        const tableId = 'table1';
        if (Object.keys(tableModule.getAllTables()).length === 0) {
            const table = tableModule.createNewTable(tableId);
            const adminName = adminModule.getRandomAdminName();
            console.log('Создание первого стола с админом-дедом:', adminName);
            
            const adminPlayer = {
                id: socket.id,
                name: adminName,
                role: 'Дед',
                isAdmin: true,
                giftSent: false
            };
            
            tableModule.addPlayer(tableId, adminPlayer);
            socket.join(tableId);
            
            socket.emit('adminTableJoined', {
                table: {
                    id: table.id,
                    players: table.players.map(p => ({
                        id: p.id,
                        name: p.name,
                        role: p.role,
                        isAdmin: p.isAdmin,
                        giftSent: p.giftSent
                    })),
                    status: table.status,
                    hasAdminGrandfather: true
                },
                chatHistory: chatModule.getTableHistory(tableId)
            });
            
            const adminSockets = adminModule.getAdminSockets();
            adminSockets.forEach(socket => {
                socket.emit('adminTablesUpdate', tableModule.getTablesInfo());
                socket.emit('adminStatsUpdate', tableModule.getGameStats());
            });
        }
    });

    // Обновляем обработчик админского присоединения к столу
    socket.on('adminJoinTable', (tableId) => {
        if (!socket.isAdmin) return;
        
        const table = tableModule.getTable(tableId);
        if (table) {
            if (socket.currentAdminTable) {
                socket.leave(socket.currentAdminTable);
            }
            
            socket.currentAdminTable = tableId;
            socket.join(tableId);
            
            const isAdminGrandfather = table.players.some(p => p.role === 'Дед' && p.isAdmin);
            console.log('Админ присоединяется к столу:', { tableId, isAdminGrandfather });
            
            socket.emit('adminTableJoined', {
                table: {
                    id: table.id,
                    players: table.players.map(p => ({
                        id: p.id,
                        name: p.name,
                        role: p.role,
                        isAdmin: p.isAdmin,
                        giftSent: p.giftSent
                    })),
                    status: table.status,
                    hasAdminGrandfather: isAdminGrandfather
                },
                chatHistory: chatModule.getTableHistory(tableId)
            });
        }
    });

    // Админ удаляет игрока
    socket.on('adminRemovePlayer', ({ tableId, playerId }) => {
        if (!socket.isAdmin) return;
        
        const table = tableModule.getTable(tableId);
        if (table) {
            const removedPlayer = tableModule.removePlayer(tableId, playerId);
            if (removedPlayer) {
                const playerSocket = io.sockets.sockets.get(playerId);
                if (playerSocket) {
                    playerSocket.leave(tableId);
                    playerSocket.emit('kicked', { message: 'Вы были удалены администратором' });
                }
                
                io.to(tableId).emit('tableUpdate', table);
                io.to(tableId).emit('chatMessage', {
                    sender: 'Система',
                    message: `Игрок ${removedPlayer.name} был удален администратором`,
                    timestamp: new Date().toLocaleTimeString(),
                    isSystem: true
                });
            }
        }
    });

    // Обработчик генерации реферальной ссылки админом
    socket.on('adminGenerateReferral', ({ tableId, sonId }) => {
        if (!socket.isAdmin) return;
        
        const table = tableModule.getTable(tableId);
        if (table) {
            const son = table.players.find(p => p.id === sonId && p.role === 'Сын');
            if (son) {
                const referral = referralModule.createReferral(son.id, son.name, tableId, true);
                
                adminModule.addLog(`Сгенерирована новая реферальная ссылка ${referral} для игрока ${son.name} (ID: ${son.id})`);
                
                socket.emit('adminReferralGenerated', {
                    referral,
                    sonName: son.name,
                    remainingUses: 3
                });
                
                const playerSocket = io.sockets.sockets.get(sonId);
                if (playerSocket) {
                    playerSocket.emit('referralGenerated', {
                        link: referral,
                        remainingUses: 3
                    });
                }
            }
        }
    });

    // Обновляем обработчик админских сообщений
    socket.on('adminChatMessage', ({ tableId, message, asPlayer }) => {
        if (!socket.isAdmin) return;
        
        const table = tableModule.getTable(tableId);
        if (table) {
            const adminGrandfather = table.players.find(p => p.role === 'Дед' && p.isAdmin);
            
            let chatMessage;
            if (asPlayer && adminGrandfather) {
                chatMessage = {
                    sender: adminGrandfather.name,
                    role: 'Дед',
                    message: message,
                    timestamp: new Date().toLocaleTimeString()
                };
            } else {
                chatMessage = {
                    sender: 'Администратор',
                    message: message,
                    timestamp: new Date().toLocaleTimeString(),
                    isAdmin: true
                };
            }
            
            chatModule.handleMessage(socket, tableId, chatMessage.sender === 'Администратор' ? { name: chatMessage.sender, role: 'admin' } : adminGrandfather, message);
        }
    });

    // Обработка входа игрока
    socket.on('login', ({ name, referral }) => {
        let tableId = referralModule.findTableIdByReferral(referral) || Object.keys(tableModule.getAllTables())[0];
        let table = tableModule.getTable(tableId);
        
        if (!table) {
            return socket.emit('loginResponse', {
                success: false,
                message: 'Стол не найден'
            });
        }

        let role;

        if (table.players.length === 1 && table.players[0].role === 'Дед') {
            role = 'Отец';
        } else if (table.players.length <= 3) {
            role = 'Сын';
        } else if (table.players.length <= 7) {
            if (!referral) {
                return socket.emit('loginResponse', {
                    success: false,
                    message: 'Для входа в качестве Духа требуется реферальная ссылка'
                });
            }
            
            const referralInfo = referralModule.getReferralInfo(referral);
            if (!referralInfo) {
                return socket.emit('loginResponse', {
                    success: false,
                    message: 'Недействительная реферальная ссылка'
                });
            }

            if (referralInfo.remainingUses <= 0) {
                return socket.emit('loginResponse', {
                    success: false,
                    message: 'Эта реферальная ссылка уже была использована максимальное количество раз'
                });
            }

            const sonStillAtTable = table.players.some(p => p.id === referralInfo.sonId);
            if (!sonStillAtTable) {
                return socket.emit('loginResponse', {
                    success: false,
                    message: 'Эта реферальная ссылка больше недействительна'
                });
            }

            role = 'Дух';
            referralModule.useReferral(referral);
        } else {
            return socket.emit('loginResponse', {
                success: false,
                message: 'Стол заполнен'
            });
        }

        const player = {
            id: socket.id,
            name,
            role,
            giftSent: false,
            invitedBy: role === 'Дух' ? referralModule.getReferralInfo(referral).sonId : null
        };

        tableModule.addPlayer(tableId, player);
        socket.join(tableId);

        socket.emit('loginResponse', { success: true, player, table });
        io.to(tableId).emit('tableUpdate', table);
        
        sendAdminUpdates();
    });

    // Обработчик генерации реферальных ссылок для Сынов
    socket.on('generateReferral', () => {
        const player = tableModule.findPlayerBySocketId(socket.id);
        if (player && player.role === 'Сын') {
            const table = tableModule.findTableByPlayerId(socket.id);
            if (!table) return;

            const existingReferrals = Array.from(referralModule.referralLinks.values())
                .filter(ref => ref.sonId === socket.id)
                .length;

            if (existingReferrals >= 2) {
                socket.emit('referralError', { message: 'Вы уже создали максимальное количество реферальных ссылок' });
                return;
            }

            const referral = referralModule.createReferral(socket.id, player.name, table.id);
            console.log(`Сгенерирована реферальная ссылка: ${referral} для игрока ${player.name}`);
            socket.emit('referralGenerated', { link: referral });
        }
    });

    // Добавляем обработчик подтверждения подарка
    socket.on('confirmGift', ({ spiritId }) => {
        const grandfather = tableModule.findPlayerBySocketId(socket.id);
        if (!grandfather || grandfather.role !== 'Дед') return;

        const table = tableModule.findTableByPlayerId(socket.id);
        if (!table) return;

        // Находим духа, чей подарок подтверждаем
        const spirit = table.players.find(p => p.id === spiritId);
        if (!spirit || spirit.role !== 'Дух' || !spirit.giftSent || spirit.giftConfirmed) return;

        // Отмечаем подарок как подтвержденный
        spirit.giftConfirmed = true;

        // Отправляем обновление всем игрокам за столом
        io.to(table.id).emit('tableUpdate', table);
        
        // Отправляем сообщение в чат
        const chatMessage = {
            sender: 'Система',
            message: `Дед ${grandfather.name} подтвердил получение подарка от Духа ${spirit.name}`,
            timestamp: new Date().toLocaleTimeString(),
            isSystem: true
        };
        
        // Сохраняем сообщение в историю чата
        chatModule.handleMessage(socket, table.id, chatMessage.sender === 'Администратор' ? { name: chatMessage.sender, role: 'admin' } : grandfather, chatMessage.message);

        // Проверяем, все ли подарки подтверждены
        const spirits = table.players.filter(p => p.role === 'Дух');
        const allGiftsConfirmed = spirits.length === 4 && spirits.every(p => p.giftConfirmed);

        if (allGiftsConfirmed) {
            // Отправляем сообщение о том, что все подарки подтверждены
            const allConfirmedMessage = {
                sender: 'Система',
                message: 'Все подарки подтверждены! Стол готов к разделению.',
                timestamp: new Date().toLocaleTimeString(),
                isSystem: true
            };
            chatModule.handleMessage(socket, table.id, allConfirmedMessage.sender === 'Администратор' ? { name: allConfirmedMessage.sender, role: 'admin' } : null, allConfirmedMessage.message);

            // Разделяем стол
            splitTable(table.id);
        }

        // Отправляем обновления админам
        sendAdminUpdates();
    });

    // Обновляем обработчик отправки подарка
    socket.on('sendGift', () => {
        const player = tableModule.findPlayerBySocketId(socket.id);
        if (!player || player.role !== 'Дух' || player.giftSent) return;

        const table = tableModule.findTableByPlayerId(socket.id);
        if (!table) return;
        
        // Отмечаем подарок как отправленный
        player.giftSent = true;

        // Отправляем сообщение в чат
        const chatMessage = {
            sender: 'Система',
            message: `Дух ${player.name} отправил подарок Деду`,
            timestamp: new Date().toLocaleTimeString(),
            isSystem: true
        };
        
        // Сохраняем сообщение в историю чата
        chatModule.handleMessage(socket, table.id, chatMessage.sender === 'Администратор' ? { name: chatMessage.sender, role: 'admin' } : null, chatMessage.message);
        
        // Отправляем обновления всем игрокам за столом
        io.to(table.id).emit('tableUpdate', table);
        io.to(table.id).emit('chatMessage', chatMessage);
        
        // Отправляем обновления админам
        sendAdminUpdates();

        // Проверка, все ли Духи отправили подарки
        const spirits = table.players.filter(p => p.role === 'Дух');
        const allGiftsSent = spirits.length === 4 && spirits.every(p => p.giftSent);

        if (allGiftsSent) {
            // Отправляем сообщение о том, что все подарки отправлены
            const allSentMessage = {
                sender: 'Система',
                message: 'Все Духи отправили подарки! Ожидается подтверждение от Деда.',
                timestamp: new Date().toLocaleTimeString(),
                isSystem: true
            };
            chatModule.handleMessage(socket, table.id, allSentMessage.sender === 'Администратор' ? { name: allSentMessage.sender, role: 'admin' } : null, allSentMessage.message);
        }
    });

    // Добавляем обработчик переподключения игрока
    socket.on('reconnectPlayer', (savedPlayer) => {
        const table = tableModule.getTable(savedPlayer.tableId);
        if (!table) {
            socket.emit('reconnectResponse', { 
                success: false, 
                message: 'Стол не найден' 
            });
            return;
        }

        // Проверяем, не занято ли место деда другим игроком
        if (savedPlayer.role === 'Дед') {
            const existingGrandfather = table.players.find(p => p.role === 'Дед' && p.id !== savedPlayer.id);
            if (existingGrandfather) {
                socket.emit('reconnectResponse', { 
                    success: false, 
                    message: 'Место деда уже занято другим игроком' 
                });
                return;
            }
        }

        // Удаляем старую запись игрока, если она есть
        tableModule.removePlayer(savedPlayer.tableId, savedPlayer.id);

        // Создаем обновленного игрока
        const updatedPlayer = {
            id: socket.id,
            name: savedPlayer.name,
            role: savedPlayer.role,
            isAdmin: savedPlayer.isAdmin,
            giftSent: savedPlayer.giftSent,
            giftConfirmed: savedPlayer.giftConfirmed
        };

        // Добавляем игрока обратно в таблицу
        tableModule.addPlayer(savedPlayer.tableId, updatedPlayer);
        
        // Присоединяем сокет к комнате стола
        socket.join(table.id);
        
        // Отправляем успешный ответ
        socket.emit('reconnectResponse', {
            success: true,
            player: updatedPlayer,
            table: table
        });

        // Обновляем информацию о столе для всех игроков
        io.to(table.id).emit('tableUpdate', table);
        
        // Отправляем обновления админам
        sendAdminUpdates();
    });

    // Обработка отключения игрока
    socket.on('disconnect', () => {
        const player = tableModule.findPlayerBySocketId(socket.id);
        if (player) {
            const table = tableModule.findTableByPlayerId(socket.id);
            if (table) {
                table.players = table.players.filter(p => p.id !== socket.id);
                io.to(table.id).emit('tableUpdate', table);
            }
        }
    });
});

// Обновляем функцию разделения стола
function splitTable(tableId) {
    const oldTable = tableModule.getTable(tableId);
    const newTable1 = tableModule.createNewTable(`${tableId}-1`);
    const newTable2 = tableModule.createNewTable(`${tableId}-2`);

    const father = oldTable.players.find(p => p.role === 'Отец');
    const sons = oldTable.players.filter(p => p.role === 'Сын');
    const spirits = oldTable.players.filter(p => p.role === 'Дух');

    // Очищаем все старые реферальные ссылки перед распределением
    clearOldReferrals(tableId);

    // Распределение игроков по новым столам
    // Первый стол
    tableModule.addPlayer(newTable1.id, { 
        ...father, 
        role: 'Дед',
        referralLinks: []
    });

    tableModule.addPlayer(newTable1.id, { 
        ...sons[0], 
        role: 'Отец',
        referralLinks: []
    });
    
    // Духи становятся Сыновьями на первом столе
    spirits.slice(0, 2).forEach(spirit => {
        tableModule.addPlayer(newTable1.id, { 
            ...spirit, 
            role: 'Сын', 
            giftSent: false,
            referralLinks: [],
            canGenerateReferrals: true
        });
    });

    // Второй стол
    tableModule.addPlayer(newTable2.id, { 
        id: 'admin-' + Date.now(),
        name: adminModule.getRandomAdminName(),
        role: 'Дед',
        isAdmin: true,
        referralLinks: []
    });

    tableModule.addPlayer(newTable2.id, { 
        ...sons[1], 
        role: 'Отец',
        referralLinks: []
    });
    
    // Духи становятся Сыновьями на втором столе
    spirits.slice(2, 4).forEach(spirit => {
        tableModule.addPlayer(newTable2.id, { 
            ...spirit, 
            role: 'Сын', 
            giftSent: false,
            referralLinks: [],
            canGenerateReferrals: true
        });
    });

    // Удаляем старый стол
    tableModule.removeTable(tableId);

    // Перемещение игроков на новые столы
    newTable1.players.forEach(player => {
        if (!player.isAdmin) {
            const socket = io.sockets.sockets.get(player.id);
            if (socket) {
                socket.leave(tableId);
                socket.join(newTable1.id);
                socket.emit('tableSplit', { 
                    newTableId: newTable1.id, 
                    table: newTable1,
                    message: 'Стол разделился! Все подарки собраны. Вы перемещены на новый стол.',
                    canGenerateReferrals: player.role === 'Сын' && player.canGenerateReferrals,
                    newRole: player.role
                });
            }
        }
    });

    newTable2.players.forEach(player => {
        if (!player.isAdmin) {
            const socket = io.sockets.sockets.get(player.id);
            if (socket) {
                socket.leave(tableId);
                socket.join(newTable2.id);
                socket.emit('tableSplit', { 
                    newTableId: newTable2.id, 
                    table: newTable2,
                    message: 'Стол разделился! Все подарки собраны. Вы перемещены на новый стол.',
                    canGenerateReferrals: player.role === 'Сын' && player.canGenerateReferrals,
                    newRole: player.role
                });
            }
        }
    });

    // Отправляем сообщение в чат о разделении стола
    io.to(newTable1.id).emit('chatMessage', {
        sender: 'Система',
        message: 'Стол разделился! Добро пожаловать на новый стол.',
        timestamp: new Date().toLocaleTimeString()
    });

    io.to(newTable2.id).emit('chatMessage', {
        sender: 'Система',
        message: 'Стол разделился! Добро пожаловать на новый стол.',
        timestamp: new Date().toLocaleTimeString()
    });

    // Создаем записи в истории чата для новых столов
    chatModule.handleMessage(null, newTable1.id, { name: 'Система', role: 'admin', message: 'Стол создан после разделения', timestamp: new Date().toLocaleTimeString(), isSystem: true });
    chatModule.handleMessage(null, newTable2.id, { name: 'Система', role: 'admin', message: 'Стол создан после разделения', timestamp: new Date().toLocaleTimeString(), isSystem: true });
    
    // Удаляем историю старого стола
    chatModule.handleMessage(null, tableId, null, null);

    // Увеличиваем счетчик закрытых столов
    gameStats.closedTables++;
    
    // Обновляем статистику для админов
    const adminSockets = Array.from(io.sockets.sockets.values())
        .filter(socket => socket.isAdmin);
    
    adminSockets.forEach(socket => {
        socket.emit('adminStatsUpdate', tableModule.getGameStats());
    });
}

function clearOldReferrals(tableId) {
    const table = tableModule.getTable(tableId);
    if (!table) return;

    // Полностью очищаем все реферальные ссылки, связанные с этим столом
    const playerIds = table.players.map(p => p.id);
    for (const [code, info] of referralModule.referralLinks.entries()) {
        if (playerIds.includes(info.sonId)) {
            referralModule.referralLinks.delete(code);
        }
    }
}

// Функция получения статистики игры
function getGameStats() {
    return {
        activeTables: Object.keys(tableModule.getAllTables()).length,
        closedTables: gameStats.closedTables,
        totalPlayers: gameStats.totalRegisteredPlayers.size,
        activePlayers: Object.values(tableModule.getAllTables()).reduce((sum, table) => sum + table.players.length, 0)
    };
}

// Функция отправки обновлений админам
function sendAdminUpdates() {
    const adminSockets = Array.from(io.sockets.sockets.values())
        .filter(socket => socket.isAdmin);
    
    const tablesInfo = tableModule.getTablesInfo();

    adminSockets.forEach(socket => {
        socket.emit('adminTablesUpdate', tablesInfo);
        if (socket.currentAdminTable) {
            const currentTable = tableModule.getTable(socket.currentAdminTable);
            if (currentTable) {
                socket.emit('adminTableJoined', {
                    table: {
                        id: currentTable.id,
                        players: currentTable.players,
                        status: currentTable.status,
                        hasAdminGrandfather: currentTable.players.some(p => p.role === 'Дед' && p.isAdmin)
                    },
                    chatHistory: chatModule.getTableHistory(currentTable.id)
                });
            }
        }
    });
}

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});