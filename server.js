const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public')); // Раздаём файлы из папки public

// Добавляем хранение истории чата для каждого стола
let chatHistory = {};

// Структура данных для хранения столов и игроков
let tables = {};

// Инициализируем историю чата для первого стола
chatHistory['table1'] = [];

// Хранилище реферальных ссылок
// Формат: { referralCode: { sonId, sonName, used, remainingUses } }
let referralLinks = new Map();

// Добавляем генератор случайных имен для администратора
const adminNames = [
    'Михаил', 'Александр', 'Николай', 'Владимир', 'Сергей', 'Андрей', 'Дмитрий', 'Иван',
    'Петр', 'Василий', 'Григорий', 'Алексей', 'Федор', 'Борис', 'Константин', 'Георгий'
];

function getRandomAdminName() {
    return adminNames[Math.floor(Math.random() * adminNames.length)];
}

// Добавляем статистику
let gameStats = {
    closedTables: 0,
    totalRegisteredPlayers: new Set(), // Храним уникальные ID игроков
    activeGames: new Map() // Храним информацию об активных столах
};

// Добавляем админские данные
const ADMIN_CREDENTIALS = {
    login: 'admin',
    password: 'admin'
};

// Добавляем систему логирования
let adminLogs = [];

function addAdminLog(message, type = 'info') {
    const log = {
        message,
        type,
        timestamp: new Date().toLocaleTimeString()
    };
    adminLogs.push(log);
    // Отправляем лог всем админам
    const adminSockets = Array.from(io.sockets.sockets.values())
        .filter(socket => socket.isAdmin);
    adminSockets.forEach(socket => {
        socket.emit('adminLog', log);
    });
}

io.on('connection', (socket) => {
    console.log(`Игрок ${socket.id} подключился`);

    // Добавляем обработчик сообщений чата
    socket.on('chatMessage', (message) => {
        const player = findPlayerBySocketId(socket.id);
        const table = findTableByPlayerId(socket.id);
        
        if (player && table) {
            // Убедимся, что история чата существует для данного стола
            if (!chatHistory[table.id]) {
                chatHistory[table.id] = [];
            }

            const chatMessage = {
                sender: player.name,
                role: player.role,
                message: message,
                timestamp: new Date().toLocaleTimeString()
            };
            
            // Сохраняем сообщение в историю
            chatHistory[table.id].push(chatMessage);
            
            // Отправляем сообщение всем в комнате, включая админов
            io.to(table.id).emit('chatMessage', chatMessage);
        }
    });

    // Добавляем обработчик входа админа
    socket.on('adminLogin', (data) => {
        if (data.login === ADMIN_CREDENTIALS.login && data.password === ADMIN_CREDENTIALS.password) {
            socket.isAdmin = true;
            socket.emit('adminLoginResponse', { 
                success: true,
                stats: getGameStats(),
                logs: adminLogs // Отправляем историю логов при входе
            });
            
            // Отправляем информацию о всех столах
            const tablesInfo = Object.entries(tables).map(([id, table]) => ({
                id,
                playersCount: table.players.length,
                status: table.status,
                hasAdminGrandfather: table.players.some(p => p.role === 'Дед' && p.isAdmin),
                players: table.players.map(p => ({
                    id: p.id,
                    name: p.name,
                    role: p.role,
                    isAdmin: p.isAdmin,
                    giftSent: p.giftSent
                }))
            }));
            socket.emit('adminTablesUpdate', tablesInfo);
        } else {
            socket.emit('adminLoginResponse', { 
                success: false, 
                message: 'Неверный логин или пароль' 
            });
        }
    });

    // Добавляем обработчик создания первого стола
    socket.on('createFirstTable', () => {
        if (!socket.isAdmin) return;
        
        const tableId = 'table1';
        if (Object.keys(tables).length === 0) {
            const table = createNewTable(tableId);
            const adminName = getRandomAdminName();
            console.log('Создание первого стола с админом-дедом:', adminName);
            
            const adminPlayer = {
                id: socket.id,
                name: adminName,
                role: 'Дед',
                isAdmin: true,
                giftSent: false
            };
            
            table.players.push(adminPlayer);
            socket.join(tableId);
            
            // Добавляем стол в список столов
            tables[tableId] = table;
            
            // Отправляем обновленную информацию
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
                chatHistory: chatHistory[tableId] || []
            });
            
            // Обновляем информацию о столах для всех админов
            const adminSockets = Array.from(io.sockets.sockets.values())
                .filter(socket => socket.isAdmin);
            
            const tablesInfo = Object.entries(tables).map(([id, table]) => ({
                id,
                playersCount: table.players.length,
                status: table.status,
                hasAdminGrandfather: table.players.some(p => p.role === 'Дед' && p.isAdmin),
                players: table.players.map(p => ({
                    id: p.id,
                    name: p.name,
                    role: p.role,
                    isAdmin: p.isAdmin,
                    giftSent: p.giftSent
                }))
            }));
            
            adminSockets.forEach(socket => {
                socket.emit('adminTablesUpdate', tablesInfo);
                socket.emit('adminStatsUpdate', getGameStats());
            });
        }
    });

    // Обновляем обработчик админского присоединения к столу
    socket.on('adminJoinTable', (tableId) => {
        if (!socket.isAdmin) return;
        
        const table = tables[tableId];
        if (table) {
            // Отписываем админа от предыдущего стола, если он был подписан
            if (socket.currentAdminTable) {
                socket.leave(socket.currentAdminTable);
            }
            
            socket.currentAdminTable = tableId;
            socket.join(tableId);
            
            // Проверяем, является ли админ дедом на этом столе
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
                chatHistory: chatHistory[tableId] || []
            });
        }
    });

    // Админ удаляет игрока
    socket.on('adminRemovePlayer', ({ tableId, playerId }) => {
        if (!socket.isAdmin) return;
        
        const table = tables[tableId];
        if (table) {
            const playerIndex = table.players.findIndex(p => p.id === playerId);
            if (playerIndex !== -1) {
                const removedPlayer = table.players.splice(playerIndex, 1)[0];
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

    // Админ генерирует реферальную ссылку
    socket.on('adminGenerateReferral', ({ tableId, sonId }) => {
        if (!socket.isAdmin) return;
        
        const table = tables[tableId];
        if (table) {
            const son = table.players.find(p => p.id === sonId && p.role === 'Сын');
            if (son) {
                const referral = generateUniqueReferral();
                referralLinks.set(referral, {
                    sonId: son.id,
                    sonName: son.name,
                    remainingUses: 3, // Увеличиваем количество использований
                    isAdminGenerated: true,
                    tableId: tableId
                });
                
                addAdminLog(`Сгенерирована новая реферальная ссылка ${referral} для игрока ${son.name} (ID: ${son.id})`);
                
                // Отправляем ссылку админу
                socket.emit('adminReferralGenerated', {
                    referral,
                    sonName: son.name,
                    remainingUses: 3
                });
                
                // Отправляем ссылку игроку
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
        
        const table = tables[tableId];
        if (table) {
            // Находим админа-деда в этом столе
            const adminGrandfather = table.players.find(p => p.role === 'Дед' && p.isAdmin);
            
            let chatMessage;
            if (asPlayer && adminGrandfather) {
                // Отправляем сообщение от имени деда
                chatMessage = {
                    sender: adminGrandfather.name,
                    role: 'Дед',
                    message: message,
                    timestamp: new Date().toLocaleTimeString()
                };
            } else {
                // Отправляем сообщение от имени админа
                chatMessage = {
                    sender: 'Администратор',
                    message: message,
                    timestamp: new Date().toLocaleTimeString(),
                    isAdmin: true
                };
            }
            
            // Сохраняем сообщение в историю чата
            if (!chatHistory[tableId]) {
                chatHistory[tableId] = [];
            }
            chatHistory[tableId].push(chatMessage);
            
            // Отправляем сообщение всем в комнате
            io.to(tableId).emit('chatMessage', chatMessage);
        }
    });

    // Обработка входа игрока
    socket.on('login', ({ name, referral }) => {
        let tableId = findTableIdByReferral(referral) || Object.keys(tables)[0];
        let table = tables[tableId];
        
        if (!table) {
            return socket.emit('loginResponse', {
                success: false,
                message: 'Стол не найден'
            });
        }

        let role;

        // Определение роли игрока
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
            
            const referralInfo = referralLinks.get(referral);
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
            referralInfo.remainingUses--;
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
            invitedBy: role === 'Дух' ? referralLinks.get(referral).sonId : null
        };
        table.players.push(player);
        socket.join(tableId);

        socket.emit('loginResponse', { success: true, player, table });
        io.to(tableId).emit('tableUpdate', table);
        
        // Отправляем обновления админам
        sendAdminUpdates();
    });

    // Генерация реферальных ссылок для Сынов (2 ссылки на каждого Сына)
    socket.on('generateReferral', () => {
        const player = findPlayerBySocketId(socket.id);
        if (player && player.role === 'Сын') {
            // Проверяем, не сгенерировал ли уже этот Сын ссылки
            const existingReferrals = Array.from(referralLinks.values())
                .filter(ref => ref.sonId === socket.id)
                .length;

            if (existingReferrals >= 2) {
                socket.emit('referralError', { message: 'Вы уже создали максимальное количество реферальных ссылок' });
                return;
            }

            const referral = generateUniqueReferral();
            console.log(`Сгенерирована реферальная ссылка: ${referral} для игрока ${player.name}`);
            referralLinks.set(referral, {
                sonId: socket.id,
                sonName: player.name,
                remainingUses: 1 // Каждая ссылка может быть использована только один раз
            });
            socket.emit('referralGenerated', { link: referral });
        }
    });

    // Добавляем обработчик подтверждения подарка
    socket.on('confirmGift', ({ spiritId }) => {
        const grandfather = findPlayerBySocketId(socket.id);
        if (!grandfather || grandfather.role !== 'Дед') return;

        const table = findTableByPlayerId(socket.id);
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
        if (!chatHistory[table.id]) {
            chatHistory[table.id] = [];
        }
        chatHistory[table.id].push(chatMessage);
        
        // Отправляем сообщение всем в комнате
        io.to(table.id).emit('chatMessage', chatMessage);

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
            chatHistory[table.id].push(allConfirmedMessage);
            io.to(table.id).emit('chatMessage', allConfirmedMessage);

            // Разделяем стол
            splitTable(table.id);
        }

        // Отправляем обновления админам
        sendAdminUpdates();
    });

    // Обновляем обработчик отправки подарка
    socket.on('sendGift', () => {
        const player = findPlayerBySocketId(socket.id);
        if (!player || player.role !== 'Дух' || player.giftSent) return;

        const table = findTableByPlayerId(socket.id);
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
        if (!chatHistory[table.id]) {
            chatHistory[table.id] = [];
        }
        chatHistory[table.id].push(chatMessage);
        
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
            chatHistory[table.id].push(allSentMessage);
            io.to(table.id).emit('chatMessage', allSentMessage);
        }
    });

    // Добавляем обработчик переподключения игрока
    socket.on('reconnectPlayer', (savedPlayer) => {
        // Находим стол игрока
        const table = tables[savedPlayer.tableId];
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
        table.players = table.players.filter(p => 
            !(p.name === savedPlayer.name && p.role === savedPlayer.role)
        );

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
        table.players.push(updatedPlayer);
        
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
        const player = findPlayerBySocketId(socket.id);
        if (player) {
            const table = findTableByPlayerId(socket.id);
            if (table) {
                table.players = table.players.filter(p => p.id !== socket.id);
                io.to(table.id).emit('tableUpdate', table);
            }
        }
    });
});

// Обновляем функцию разделения стола
function splitTable(tableId) {
    const oldTable = tables[tableId];
    const newTable1 = createNewTable(`${tableId}-1`);
    const newTable2 = createNewTable(`${tableId}-2`);

    const father = oldTable.players.find(p => p.role === 'Отец');
    const sons = oldTable.players.filter(p => p.role === 'Сын');
    const spirits = oldTable.players.filter(p => p.role === 'Дух');

    // Очищаем все старые реферальные ссылки перед распределением
    clearOldReferrals(tableId);

    // Распределение игроков по новым столам
    // Первый стол
    newTable1.players.push({ 
        ...father, 
        role: 'Дед',
        referralLinks: [] // Очищаем реферальные ссылки у нового Деда
    });

    newTable1.players.push({ 
        ...sons[0], 
        role: 'Отец',
        referralLinks: [] // Очищаем реферальные ссылки у нового Отца
    });
    
    // Духи становятся Сыновьями на первом столе
    spirits.slice(0, 2).forEach(spirit => {
        newTable1.players.push({ 
            ...spirit, 
            role: 'Сын', 
            giftSent: false,
            referralLinks: [], // Очищаем старые реферальные ссылки
            canGenerateReferrals: true // Флаг для генерации новых реферальных ссылок
        });
    });

    // Второй стол
    newTable2.players.push({ 
        id: 'admin-' + Date.now(),
        name: getRandomAdminName(),
        role: 'Дед',
        isAdmin: true,
        referralLinks: []
    });

    newTable2.players.push({ 
        ...sons[1], 
        role: 'Отец',
        referralLinks: [] // Очищаем реферальные ссылки у нового Отца
    });
    
    // Духи становятся Сыновьями на втором столе
    spirits.slice(2, 4).forEach(spirit => {
        newTable2.players.push({ 
            ...spirit, 
            role: 'Сын', 
            giftSent: false,
            referralLinks: [], // Очищаем старые реферальные ссылки
            canGenerateReferrals: true // Флаг для генерации новых реферальных ссылок
        });
    });

    // Обновление списка столов
    delete tables[tableId];
    tables[newTable1.id] = newTable1;
    tables[newTable2.id] = newTable2;

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
    chatHistory[newTable1.id] = [{
        sender: 'Система',
        message: 'Стол создан после разделения',
        timestamp: new Date().toLocaleTimeString(),
        isSystem: true
    }];
    
    chatHistory[newTable2.id] = [{
        sender: 'Система',
        message: 'Стол создан после разделения',
        timestamp: new Date().toLocaleTimeString(),
        isSystem: true
    }];
    
    // Удаляем историю старого стола
    delete chatHistory[tableId];

    // Увеличиваем счетчик закрытых столов
    gameStats.closedTables++;
    
    // Обновляем статистику для админов
    const adminSockets = Array.from(io.sockets.sockets.values())
        .filter(socket => socket.isAdmin);
    
    adminSockets.forEach(socket => {
        socket.emit('adminStatsUpdate', getGameStats());
    });
}

// Обновляем функцию создания стола
function createNewTable(id) {
    chatHistory[id] = []; // Инициализируем историю чата для нового стола
    return {
        id,
        players: [],
        status: 'waiting',
        maxPlayers: 8
    };
}

function generateUniqueReferral() {
    return 'ref-' + Math.random().toString(36).substring(2, 15);
}

function findPlayerBySocketId(socketId) {
    for (const tableId in tables) {
        const player = tables[tableId].players.find(p => p.id === socketId);
        if (player) return player;
    }
    return null;
}

function findTableByPlayerId(socketId) {
    return Object.values(tables).find(table => 
        table.players.some(player => player.id === socketId)
    );
}

function clearOldReferrals(tableId) {
    const table = tables[tableId];
    if (!table) return;

    // Полностью очищаем все реферальные ссылки, связанные с этим столом
    const playerIds = table.players.map(p => p.id);
    for (const [code, info] of referralLinks.entries()) {
        if (playerIds.includes(info.sonId)) {
            referralLinks.delete(code);
        }
    }
}

// Добавляем новую функцию для поиска стола по реферальной ссылке
function findTableIdByReferral(referral) {
    if (!referral) return null;
    
    const referralInfo = referralLinks.get(referral);
    if (!referralInfo) return null;

    // Ищем стол, где находится Сын, создавший ссылку
    for (const [tableId, table] of Object.entries(tables)) {
        if (table.players.some(p => p.id === referralInfo.sonId)) {
            return tableId;
        }
    }
    return null;
}

// Функция получения статистики игры
function getGameStats() {
    return {
        activeTables: Object.keys(tables).length,
        closedTables: gameStats.closedTables,
        totalPlayers: gameStats.totalRegisteredPlayers.size,
        activePlayers: Object.values(tables).reduce((sum, table) => sum + table.players.length, 0)
    };
}

// Функция отправки обновлений админам
function sendAdminUpdates() {
    const adminSockets = Array.from(io.sockets.sockets.values())
        .filter(socket => socket.isAdmin);
    
    const tablesInfo = Object.entries(tables).map(([id, table]) => ({
        id,
        playersCount: table.players.length,
        status: table.status,
        hasAdminGrandfather: table.players.some(p => p.role === 'Дед' && p.isAdmin),
        players: table.players.map(p => ({
            id: p.id,
            name: p.name,
            role: p.role,
            isAdmin: p.isAdmin,
            giftSent: p.giftSent,
            giftConfirmed: p.giftConfirmed
        }))
    }));

    adminSockets.forEach(socket => {
        socket.emit('adminTablesUpdate', tablesInfo);
        if (socket.currentAdminTable) {
            const currentTable = tables[socket.currentAdminTable];
            if (currentTable) {
                socket.emit('adminTableJoined', {
                    table: {
                        id: currentTable.id,
                        players: currentTable.players,
                        status: currentTable.status,
                        hasAdminGrandfather: currentTable.players.some(p => p.role === 'Дед' && p.isAdmin)
                    },
                    chatHistory: chatHistory[currentTable.id] || []
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